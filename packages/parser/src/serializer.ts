/**
 * GraphSerializer (R7, R8, R9) — emit the in-memory graph as the canonical
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
 * - **Atomic, no-partial write (R8).** The full document is serialized in
 *   memory, written to a temp file in the *same* directory, then `fs.rename`d
 *   over `graph.json`. Any failure returns `output-unwritable` and leaves no
 *   partial/empty output; a prior valid file is untouched because the rename
 *   never happens (R8.4, R8.5, R10.6). On success no temp file is left behind.
 *
 * The filesystem operations are injected via {@link SerializerDeps} so the
 * write-failure branches can be simulated deterministically in tests without
 * touching the real filesystem, while happy-path tests use a real temp dir.
 */

import * as nodeFs from "node:fs/promises";
import * as path from "node:path";

import type {
  DependencyEdge,
  GraphNode,
  RawDependencyGraph,
} from "@repohive/shared";

import { stringifyGraph } from "./canonical.js";
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
  writeFile(filePath: string, data: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  /** Best-effort cleanup of a temp file; never rejects fatally. */
  unlink(filePath: string): Promise<void>;
}

const defaultDeps: SerializerDeps = {
  writeFile: (filePath, data) => nodeFs.writeFile(filePath, data, "utf8"),
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
   */
  write(
    nodes: GraphNode[],
    edges: DependencyEdge[],
    outputPath: string,
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
 */
function normalizeNode(node: GraphNode): GraphNode {
  const normalized: GraphNode = {
    id: node.id,
    kind: node.kind,
    directoryPath: node.directoryPath,
  };
  if (node.packagePath !== undefined && node.packagePath !== "") {
    normalized.packagePath = node.packagePath;
  }
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
 * Nodes are normalized for field omission; edges are normalized for field
 * projection and then swept so that any edge whose `source` or `target` is not
 * an emitted node id is dropped with a diagnostic (R7.6). Ordering is left to
 * {@link stringifyGraph}, which sorts canonically.
 */
function buildGraph(
  nodes: GraphNode[],
  edges: DependencyEdge[],
  onDiagnostic: DiagnosticSink,
): RawDependencyGraph {
  const normalizedNodes = nodes.map(normalizeNode);
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

  return { nodes: normalizedNodes, edges: emittedEdges };
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
      const graph = buildGraph(nodes, edges, onDiagnostic);

      // Serialize the entire document in memory first, so a serialization
      // failure never leaves a partial file on disk (R8.4).
      let document: string;
      try {
        document = stringifyGraph(graph);
      } catch (error) {
        return err([
          makeError(
            "output-unwritable",
            `Failed to serialize the dependency graph: ${describeFailure(error)}`,
            outputPath,
          ),
        ]);
      }

      // Temp file lives in the SAME directory as the target so the final
      // `rename` is an atomic same-filesystem move (R8, R10.6).
      const tempPath = `${outputPath}.tmp`;

      // Write the temp file. On failure, best-effort remove any partial temp
      // file and return `output-unwritable`; the target is never touched, so a
      // prior valid `graph.json` is left byte-for-byte intact (R8.4, R10.6).
      try {
        await deps.writeFile(tempPath, document);
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

      return ok<ParseSuccess, ParseError>({
        outputPath,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
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
  outputPath: string,
  deps: SerializerDeps = defaultDeps,
  onDiagnostic: DiagnosticSink = noopDiagnostics,
): Promise<Result<ParseSuccess, ParseError>> {
  return createGraphSerializer(deps, onDiagnostic).write(
    nodes,
    edges,
    outputPath,
  );
}
