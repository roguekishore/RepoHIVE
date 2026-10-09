/**
 * GraphSerializer (R7, R8, R9) - emit the in-memory graph as the canonical
 * `graph.json`, conforming to the shared JSON contract and writing atomically.
 *
 * Responsibilities (design: "GraphSerializer (R7, R8, R9)"):
 * - **Contract conformance (R7).** Each node/edge is emitted per the
 *   `@repohive/shared` contract, with field-omission semantics: `definedInFile`
 *   is omitted on `file` nodes and present on `class`/`function` nodes (R7.2);
 *   `packagePath` is emitted only when non-empty and omitted otherwise (R7.3);
 *   the three edge frequency signals are non-negative integers in
 *   `[0, 2147483647]` (R7.4); `strength` is never emitted (R7.7).
 * - **Final endpoint sweep (R7.6).** Any edge referencing an absent node id is
 *   dropped and a diagnostic recorded, so no dangling reference is ever
 *   written. This is a defensive backstop; the `Stitcher` already guarantees
 *   valid endpoints.
 * - **Canonical order (R9.2, R9.3).** Emission order is fully determined by
 *   content via the stable stringifier, independent of input order.
 * - **Atomic, no-partial write (R8).** The document is streamed as chunks (never
 *   one whole-document string, which would hit V8's string-length limit on a
 *   very large repository) to a temp file in the *same* directory, then
 *   `fs.rename`d over `graph.json`. Any failure returns `output-unwritable` and leaves no
 *   partial/empty output; a prior valid file is untouched because the rename
 *   never happens (R8.4, R8.5, R10.6). On success no temp file is left behind.
 * - **In-memory handoff.** On success the canonical graph is returned on
 *   {@link ParseSuccess.graph} as well as written, so an in-process consumer
 *   can group straight from memory. It is the same document in the same order
 *   as the file, so the two paths cannot diverge.
 *
 * The filesystem operations are injected via {@link SerializerDeps} so the
 * write-failure branches can be simulated deterministically in tests without
 * touching the real filesystem, while happy-path tests use a real temp dir.
 */

import * as nodeFs from "node:fs/promises";
import * as path from "node:path";

import { coalesceChunks } from "@repohive/shared";

import type {
  DependencyEdge,
  GraphNode,
  RawDependencyGraph,
} from "@repohive/shared";

import { sortGraphCanonically, stringifyGraphPieces } from "./canonical.js";
import {
  err,
  makeError,
  ok,
  type ParseError,
  type ParseSuccess,
  type Result,
} from "./errors.js";

/** The maximum value permitted for an edge frequency signal (R7.4). */
const MAX_FREQUENCY = 2_147_483_647;

/**
 * Filesystem operations the serializer depends on. Defaults to
 * `node:fs/promises`; tests inject stubs to simulate temp-write and rename
 * failures. The three operations mirror the atomic-write sequence: write the
 * document to a temp path, rename it over the target, and (on failure) remove
 * any temp file that was created.
 */
export interface SerializerDeps {
  /**
   * Write the chunks, in order, as one UTF-8 file. The chunks are produced
   * lazily and none is the whole document; an implementation must consume them
   * one at a time rather than joining them.
   */
  writeChunks(filePath: string, chunks: Iterable<string>): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  /** Best-effort cleanup of a temp file; never rejects fatally. */
  unlink(filePath: string): Promise<void>;
}

const defaultDeps: SerializerDeps = {
  writeChunks: async (filePath, chunks) => {
    const handle = await nodeFs.open(filePath, "w");
    try {
      for (const chunk of chunks) {
        await handle.write(chunk, null, "utf8");
      }
    } finally {
      await handle.close();
    }
  },
  rename: (oldPath, newPath) => nodeFs.rename(oldPath, newPath),
  unlink: (filePath) => nodeFs.unlink(filePath),
};

/**
 * Optional diagnostic sink for the endpoint sweep (R7.6). Defaults to a no-op
 * so the serializer stays quiet by default; the orchestrator or tests may
 * inject a collector to observe dropped-edge diagnostics.
 */
export type DiagnosticSink = (message: string) => void;

const noopDiagnostics: DiagnosticSink = () => {};

/** The public GraphSerializer interface (design: "GraphSerializer (R7, R8, R9)"). */
export interface GraphSerializer {
  /**
   * Serialize `nodes`/`edges` to a canonical `graph.json` at `outputPath`,
   * writing atomically. `outputPath` is the full path to the target file; the
   * temp file is created in the same directory.
   *
   * With `outputPath` undefined nothing is written and no path is reported: the
   * graph is still validated, swept and sorted, and handed back in
   * {@link ParseSuccess.graph}, exactly as it would have been written.
   */
  write(
    nodes: GraphNode[],
    edges: DependencyEdge[],
    outputPath: string | undefined,
  ): Promise<Result<ParseSuccess, ParseError>>;
}

/**
 * Normalize an edge frequency signal to a non-negative integer within
 * `[0, MAX_FREQUENCY]` (R7.4). Defensive backstop: upstream already guarantees
 * finite non-negative integers, but clamping here ensures the emitted document
 * never violates the contract even if a malformed value slips through.
 */
function normalizeFrequency(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const truncated = Math.trunc(value);
  if (truncated < 0) {
    return 0;
  }
  if (truncated > MAX_FREQUENCY) {
    return MAX_FREQUENCY;
  }
  return truncated;
}

/**
 * Apply the contract's field-omission semantics to a node (R7.2, R7.3).
 *
 * - `packagePath`: omitted (left `undefined`) when absent or empty; the stable
 *   stringifier omits `undefined` fields, so this is how "no declared package"
 *   is represented rather than an empty string.
 * - `definedInFile`: omitted on `file` nodes and preserved on `class` /
 *   `function` nodes.
 * - `strength` never exists on a node; frequency handling is edge-only.
 *
 * Properties are inserted in the order the canonical stringifier emits them
 * (`id`, `kind`, `packagePath`, `directoryPath`, `definedInFile`). Emission
 * does not depend on this (`stringifyNode` writes a fixed key order whatever
 * it is handed) but it makes the in-memory handoff in
 * {@link ParseSuccess.graph} match the written document down to property
 * order, so re-stringifying the handoff cannot produce different bytes.
 */
function normalizeNode(node: GraphNode): GraphNode {
  const hasPackagePath =
    node.packagePath !== undefined && node.packagePath !== "";
  const normalized: GraphNode = hasPackagePath
    ? {
        id: node.id,
        kind: node.kind,
        packagePath: node.packagePath,
        directoryPath: node.directoryPath,
      }
    : { id: node.id, kind: node.kind, directoryPath: node.directoryPath };
  if (node.kind !== "file" && node.definedInFile !== undefined) {
    normalized.definedInFile = node.definedInFile;
  }
  return normalized;
}

/**
 * Project an edge onto exactly the contract's emitted fields with normalized
 * integer frequencies. `strength` is dropped here so it is never emitted
 * (R7.7), independent of the stringifier.
 */
function normalizeEdge(edge: DependencyEdge): DependencyEdge {
  return {
    source: edge.source,
    target: edge.target,
    importFrequency: normalizeFrequency(edge.importFrequency),
    methodCallFrequency: normalizeFrequency(edge.methodCallFrequency),
    sharedTypeCount: normalizeFrequency(edge.sharedTypeCount),
  };
}

/**
 * Build the contract-conforming, endpoint-swept graph ready for canonical
 * stringification.
 *
 * Nodes are normalized for field omission; a global uniqueness gate rejects
 * any graph containing duplicate node ids (R3.12, Fix 7 - Gap 5), returning a
 * structured diagnostic naming both defining files. Edges are normalized for
 * field projection and then swept so that any edge whose `source` or `target`
 * is not an emitted node id is dropped with a diagnostic (R7.6). Ordering is
 * left to {@link stringifyGraph}, which sorts canonically.
 */
function buildGraph(
  nodes: GraphNode[],
  edges: DependencyEdge[],
  onDiagnostic: DiagnosticSink,
): { graph: RawDependencyGraph; duplicateError?: ParseError } {
  const normalizedNodes = nodes.map(normalizeNode);

  // Global node-id uniqueness gate (R3.12, Fix 7 - Gap 5).
  // Two structurally distinct declarations producing the same id is a parser
  // defect; surface it as a structured error naming both defining files so the
  // diagnostic is actionable rather than silently dropping one.
  const seen = new Map<string, string>(); // id -> defining file id
  for (const node of normalizedNodes) {
    const previous = seen.get(node.id);
    if (previous !== undefined) {
      const definingFile =
        node.definedInFile ?? node.id;
      const duplicateError: ParseError = makeError(
        "duplicate-node-id",
        `Two distinct declarations produced the same node identifier "${node.id}" ` +
          `(defined in ${previous} and ${definingFile})`,
        definingFile,
      );
      return { graph: { nodes: [], edges: [] }, duplicateError };
    }
    seen.set(node.id, node.definedInFile ?? node.id);
  }

  const nodeIds = new Set(normalizedNodes.map((n) => n.id));

  const emittedEdges: DependencyEdge[] = [];
  for (const edge of edges) {
    const sourceExists = nodeIds.has(edge.source);
    const targetExists = nodeIds.has(edge.target);
    if (!sourceExists || !targetExists) {
      const missing = !sourceExists ? edge.source : edge.target;
      onDiagnostic(
        `Dropping dangling edge (${edge.source} -> ${edge.target}): ` +
          `endpoint "${missing}" is not an emitted node.`,
      );
      continue;
    }
    emittedEdges.push(normalizeEdge(edge));
  }

  return { graph: { nodes: normalizedNodes, edges: emittedEdges } };
}

/** Extract a filesystem error code (`ENOENT`, `EACCES`, ...) if present. */
function errorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

/** A short human description of a write failure for the error message. */
function describeFailure(error: unknown): string {
  const code = errorCode(error);
  if (code === "EACCES" || code === "EPERM") {
    return "insufficient permissions";
  }
  if (code === "ENOENT") {
    return "the output directory does not exist";
  }
  if (code === "ENOSPC") {
    return "no space left on device";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "the file could not be written";
}

/**
 * Create a {@link GraphSerializer} over the given filesystem dependencies and
 * diagnostic sink. Omit `deps` to use the real `node:fs/promises`.
 */
export function createGraphSerializer(
  deps: SerializerDeps = defaultDeps,
  onDiagnostic: DiagnosticSink = noopDiagnostics,
): GraphSerializer {
  return {
    async write(nodes, edges, outputPath) {
      const { graph, duplicateError } = buildGraph(nodes, edges, onDiagnostic);

      // Duplicate node id: return the structured error immediately, write nothing.
      if (duplicateError !== undefined) {
        return err([duplicateError]);
      }

      // Sort once, here, so the graph handed back in `ParseSuccess.graph` is
      // the same document in the same order as the bytes written to disk.
      // `stringifyGraph` sorts defensively too (its contract is independent of
      // input order); on already-sorted input that is a no-op.
      const canonical = sortGraphCanonically(graph);

      // No file requested: the document is the in-memory handoff alone.
      if (outputPath === undefined) {
        return ok<ParseSuccess, ParseError>({
          nodeCount: canonical.nodes.length,
          edgeCount: canonical.edges.length,
          graph: canonical,
        });
      }

      // Temp file lives in the SAME directory as the target so the final
      // `rename` is an atomic same-filesystem move (R8, R10.6).
      const tempPath = `${outputPath}.tmp`;

      // Write the temp file. On failure, best-effort remove any partial temp
      // file and return `output-unwritable`; the target is never touched, so a
      // prior valid `graph.json` is left byte-for-byte intact (R8.4, R10.6).
      try {
        await deps.writeChunks(tempPath, coalesceChunks(stringifyGraphPieces(canonical)));
      } catch (error) {
        await deps.unlink(tempPath).catch(() => {});
        return err([
          makeError(
            "output-unwritable",
            `Failed to write the graph output (${describeFailure(error)}): ${outputPath}`,
            outputPath,
          ),
        ]);
      }

      // Atomically move the temp file over the target. If the rename fails the
      // target is unchanged; remove the temp file so none is left behind
      // (R8.5, R10.6).
      try {
        await deps.rename(tempPath, outputPath);
      } catch (error) {
        await deps.unlink(tempPath).catch(() => {});
        return err([
          makeError(
            "output-unwritable",
            `Failed to finalize the graph output (${describeFailure(error)}): ${outputPath}`,
            outputPath,
          ),
        ]);
      }

      // Hand the written document back in memory as well (R8 unchanged: the
      // file is still the artifact). An in-process consumer can group straight
      // from this instead of reading `graph.json` back.
      return ok<ParseSuccess, ParseError>({
        outputPath,
        nodeCount: canonical.nodes.length,
        edgeCount: canonical.edges.length,
        graph: canonical,
      });
    },
  };
}

/**
 * Convenience wrapper: serialize and atomically write a graph to `outputPath`
 * using the real filesystem (or injected {@link SerializerDeps} for tests).
 */
export function writeGraph(
  nodes: GraphNode[],
  edges: DependencyEdge[],
  outputPath: string | undefined,
  deps: SerializerDeps = defaultDeps,
  onDiagnostic: DiagnosticSink = noopDiagnostics,
): Promise<Result<ParseSuccess, ParseError>> {
  return createGraphSerializer(deps, onDiagnostic).write(
    nodes,
    edges,
    outputPath,
  );
}
