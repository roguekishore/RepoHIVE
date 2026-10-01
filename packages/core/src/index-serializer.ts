/**
 * Index_Serializer: write the five-file Index_File_Set —
 * repository.json, hierarchy.json, nodes.json, edges.json, metadata.json —
 * via the stable stringifier so identical hierarchies serialize
 * byte-identically. A failed write is reported as WRITE_FAILED naming the
 * file.
 *
 * The write is **all-or-nothing** (Gap 10). Writing the five files in sequence
 * meant a failure partway through — a read-only member, ENOSPC, a permissions
 * change — left a directory holding some new files and some old ones, which
 * `parseIndex` happily accepted because each file was individually well-formed.
 * The fix mirrors the parser's serializer: render every payload in memory,
 * stage the whole set into a sibling directory, and only then promote. Every
 * condition that can realistically fail does so during staging, before the
 * target has been touched at all.
 */

import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { access, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { coalesceChunks } from "@repohive/shared";
import { compareDependencyEdges, sortByIds, stableStringifyPieces } from "./canonical.js";
import { err, ok, type Result } from "./errors.js";
import type { Hierarchy, Metadata } from "./types.js";

export const INDEX_FILE_NAMES = [
  "repository.json",
  "hierarchy.json",
  "nodes.json",
  "edges.json",
  "metadata.json",
] as const;

export type IndexFileName = (typeof INDEX_FILE_NAMES)[number];

/** Pure projection of a Hierarchy + Metadata onto the five file payloads. */
export function indexFilePayloads(hierarchy: Hierarchy, metadata: Metadata): Record<IndexFileName, unknown> {
  const hierarchyNodes = sortByIds([...hierarchy.nodes.values()]);

  return {
    "repository.json": {
      repositoryId: hierarchy.repositoryId,
      hierarchyDepth: hierarchy.depth,
      nodeCount: hierarchy.nodes.size,
      edgeCount: hierarchy.leafEdges.length + hierarchy.crossGroupEdges.length,
    },
    "hierarchy.json": {
      repositoryId: hierarchy.repositoryId,
      nodes: hierarchyNodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        level: node.level,
        parentId: node.parentId,
        childIds: node.childIds,
      })),
    },
    "nodes.json": {
      nodes: hierarchyNodes.map((node) => {
        const attributes = hierarchy.leafAttributes.get(node.id);
        return {
          id: node.id,
          kind: node.kind,
          level: node.level,
          // Region provenance (Gap 12), omitted on the Repository node and on
          // the wrapper groups that correspond to no region.
          ...(node.regionId !== undefined ? { regionId: node.regionId } : {}),
          ...(node.ordinal !== undefined ? { ordinal: node.ordinal } : {}),
          ...(attributes?.packagePath !== undefined ? { packagePath: attributes.packagePath } : {}),
          ...(attributes?.directoryPath !== undefined ? { directoryPath: attributes.directoryPath } : {}),
          ...(attributes?.definedInFile !== undefined ? { definedInFile: attributes.definedInFile } : {}),
        };
      }),
    },
    "edges.json": {
      leafEdges: [...hierarchy.leafEdges].sort(compareDependencyEdges).map((edge) => ({
        source: edge.source,
        target: edge.target,
        importFrequency: edge.importFrequency,
        methodCallFrequency: edge.methodCallFrequency,
        sharedTypeCount: edge.sharedTypeCount,
        strength: edge.strength,
      })),
      crossGroupEdges: hierarchy.crossGroupEdges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        level: edge.level,
        weight: edge.weight,
      })),
    },
    "metadata.json": metadata,
  };
}

/**
 * Filesystem operations the serializer needs, injected so the failure paths are
 * testable. The write path was previously unreachable from a test without
 * manipulating real permissions, which is why the mixed-index hazard went
 * unnoticed.
 */
export interface IndexSerializerDeps {
  mkdirSync(path: string): void;
  /**
   * Write the chunks, in order, as one UTF-8 file. The chunks are produced
   * lazily and no chunk is the whole file; an implementation must consume them
   * one at a time rather than joining them.
   */
  writeChunksSync(path: string, chunks: Iterable<string>): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string): void;
  existsSync(path: string): boolean;
  /** Throws when `path` exists but is not writable. */
  assertWritable(path: string): void;
}

const defaultDeps: IndexSerializerDeps = {
  mkdirSync: (path) => {
    mkdirSync(path, { recursive: true });
  },
  writeChunksSync: (path, chunks) => {
    const fd = openSync(path, "w");
    try {
      for (const chunk of chunks) {
        const bytes = Buffer.from(chunk, "utf8");
        let offset = 0;
        while (offset < bytes.length) {
          offset += writeSync(fd, bytes, offset, bytes.length - offset);
        }
      }
    } finally {
      closeSync(fd);
    }
  },
  renameSync: (from, to) => {
    renameSync(from, to);
  },
  rmSync: (path) => {
    rmSync(path, { recursive: true, force: true });
  },
  existsSync: (path) => existsSync(path),
  assertWritable: (path) => {
    accessSync(path, fsConstants.W_OK);
  },
};

/** One payload as write-sized chunks; the concatenation is `stableStringify(payload)`. */
function renderChunks(payload: unknown): Generator<string, void, undefined> {
  return coalesceChunks(stableStringifyPieces(payload));
}

/**
 * Render every payload once, as chunks, before touching the filesystem, so a
 * serialization failure writes nothing at all. The pass feeds an incremental hash
 * (it names the staging directory) and discards the text: nothing here holds a
 * whole file as one string. The write renders again; rendering is a pure
 * function of the payload, so the two passes agree.
 */
function renderAndHash(
  hierarchy: Hierarchy,
  metadata: Metadata,
  dir: string,
): Result<{ payloads: Record<IndexFileName, unknown>; staging: string }> {
  const hash = createHash("sha1");
  try {
    const payloads = indexFilePayloads(hierarchy, metadata);
    for (const name of INDEX_FILE_NAMES) {
      for (const chunk of renderChunks(payloads[name])) {
        hash.update(chunk, "utf8");
      }
      hash.update("\0");
    }
    // The staging name is derived from the content: no timestamp, no counter, no
    // randomness, so determinism is preserved and a re-run over identical input
    // reuses the same staging path.
    return ok({ payloads, staging: `${dir}.staging-${hash.digest("hex").slice(0, 16)}` });
  } catch (cause) {
    return err({ code: "WRITE_FAILED", file: dir, detail: `serialization failed: ${String(cause)}` });
  }
}

export function serializeIndex(
  hierarchy: Hierarchy,
  metadata: Metadata,
  dir: string,
  deps: IndexSerializerDeps = defaultDeps
): Result<void> {
  // 1. Render and hash before touching the filesystem.
  const rendered = renderAndHash(hierarchy, metadata, dir);
  if (!rendered.ok) {
    return rendered;
  }
  const { payloads, staging } = rendered.value;

  // 2. A read-only *existing* target is the one failure that renames cannot
  //    avoid, so detect it up front and turn it into a staged-phase failure.
  try {
    for (const name of INDEX_FILE_NAMES) {
      const target = join(dir, name);
      if (deps.existsSync(target)) {
        deps.assertWritable(target);
      }
    }
  } catch (cause) {
    return err({ code: "WRITE_FAILED", file: dir, detail: `target not writable: ${String(cause)}` });
  }

  // 3. Stage into a sibling directory.
  try {
    deps.rmSync(staging);
    deps.mkdirSync(staging);
    for (const name of INDEX_FILE_NAMES) {
      deps.writeChunksSync(join(staging, name), renderChunks(payloads[name]));
    }
  } catch (cause) {
    deps.rmSync(staging);
    return err({ code: "WRITE_FAILED", file: staging, detail: String(cause) });
  }

  // 4. Promote only once all five exist. These are renames within one directory
  //    tree, so each is atomic and cannot fail for space or content reasons —
  //    the window in which the set is mixed is five metadata operations wide.
  try {
    deps.mkdirSync(dir);
    for (const name of INDEX_FILE_NAMES) {
      deps.renameSync(join(staging, name), join(dir, name));
    }
    deps.rmSync(staging);
    return ok(undefined);
  } catch (cause) {
    deps.rmSync(staging);
    return err({ code: "WRITE_FAILED", file: dir, detail: `promotion failed: ${String(cause)}` });
  }
}

/**
 * Asynchronous counterpart of {@link IndexSerializerDeps}, for
 * {@link serializeIndexAsync}. Same operations, each returning a promise.
 */
export interface IndexSerializerAsyncDeps {
  mkdir(path: string): Promise<void>;
  /**
   * Write the chunks, in order, as one UTF-8 file. The chunks are produced
   * lazily and no chunk is the whole file; an implementation must consume them
   * one at a time rather than joining them.
   */
  writeChunks(path: string, chunks: Iterable<string>): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Rejects when `path` exists but is not writable. */
  assertWritable(path: string): Promise<void>;
}

const defaultAsyncDeps: IndexSerializerAsyncDeps = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  writeChunks: async (path, chunks) => {
    const handle = await open(path, "w");
    try {
      for (const chunk of chunks) {
        const bytes = Buffer.from(chunk, "utf8");
        let offset = 0;
        while (offset < bytes.length) {
          offset += (await handle.write(bytes, offset, bytes.length - offset)).bytesWritten;
        }
      }
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => rename(from, to),
  rm: (path) => rm(path, { recursive: true, force: true }),
  exists: async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  assertWritable: (path) => access(path, fsConstants.W_OK),
};

/**
 * {@link serializeIndex} with asynchronous I/O: the five files are written
 * concurrently into the staging directory. Same all-or-nothing staging then
 * promotion, same bytes, same failure results. Every write has settled (or
 * failed) before the staging directory is removed, so a failure never races an
 * open file.
 */
export async function serializeIndexAsync(
  hierarchy: Hierarchy,
  metadata: Metadata,
  dir: string,
  deps: IndexSerializerAsyncDeps = defaultAsyncDeps,
): Promise<Result<void>> {
  const rendered = renderAndHash(hierarchy, metadata, dir);
  if (!rendered.ok) {
    return rendered;
  }
  const { payloads, staging } = rendered.value;

  try {
    for (const name of INDEX_FILE_NAMES) {
      const target = join(dir, name);
      if (await deps.exists(target)) {
        await deps.assertWritable(target);
      }
    }
  } catch (cause) {
    return err({ code: "WRITE_FAILED", file: dir, detail: `target not writable: ${String(cause)}` });
  }

  try {
    await deps.rm(staging);
    await deps.mkdir(staging);
    const settled = await Promise.allSettled(
      INDEX_FILE_NAMES.map((name) => deps.writeChunks(join(staging, name), renderChunks(payloads[name]))),
    );
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        throw outcome.reason;
      }
    }
  } catch (cause) {
    await deps.rm(staging).catch(() => undefined);
    return err({ code: "WRITE_FAILED", file: staging, detail: String(cause) });
  }

  try {
    await deps.mkdir(dir);
    for (const name of INDEX_FILE_NAMES) {
      await deps.rename(join(staging, name), join(dir, name));
    }
    await deps.rm(staging);
    return ok(undefined);
  } catch (cause) {
    await deps.rm(staging).catch(() => undefined);
    return err({ code: "WRITE_FAILED", file: dir, detail: `promotion failed: ${String(cause)}` });
  }
}
