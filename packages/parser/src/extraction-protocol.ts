/**
 * The wire format between the extraction pool (main thread) and its workers.
 *
 * Everything that crosses the boundary in bulk is a typed array plus a string
 * table (see `string-table.ts`): no object graph is ever structured-cloned. Three
 * record shapes are involved, each a flat `Int32Array` with a fixed stride:
 *
 * - **node**: `[id, kind, packagePath, directoryPath, definedInFile]`, strings by
 *   table id, `-1` for an absent optional field;
 * - **symbol entry**: `[id, key, scope, kind]`;
 * - **edge**: `[source, target, importFrequency, methodCallFrequency,
 *   sharedTypeCount]`.
 *
 * Frequencies fit an int32 because the contract caps them at 2147483647.
 */

import type { DependencyEdge, GraphNode } from "@repohive/shared";

import type { ParseError } from "./errors.js";
import type { SymbolEntry } from "./symbol-table.js";
import { StringTableBuilder, decodeStrings, type EncodedStrings } from "./string-table.js";

/** Int32 fields per node record. */
export const NODE_STRIDE = 5;
/** Int32 fields per symbol-entry record. */
export const ENTRY_STRIDE = 4;
/** Int32 fields per edge record. */
export const EDGE_STRIDE = 5;

const NODE_KIND_CODES = { file: 0, class: 1, function: 2 } as const;
const NODE_KINDS = ["file", "class", "function"] as const;
const ENTRY_KIND_CODES = { class: 0, function: 1 } as const;
const ENTRY_KINDS = ["class", "function"] as const;

// --- Main to worker ----------------------------------------------------------

/** One file to extract. `bytes` is transferred, not copied. */
export interface ExtractRequest {
  type: "extract";
  /** Index into the canonical file list. */
  fileIndex: number;
  /** Root-relative POSIX path, the only path material that enters a node id. */
  relativePath: string;
  bytes: Uint8Array;
}

/** The merged, read-only symbol table, in shared memory so every worker reads one copy. */
export interface SymbolTablePayload {
  strings: EncodedStrings;
  /** `ENTRY_STRIDE` ints per entry, in canonical id order. */
  entries: Int32Array;
}

export type ToWorker =
  | ExtractRequest
  /** Phase 1 is over: send back everything extracted. */
  | { type: "finish-extraction" }
  /** Phase 2: stitch the files you extracted against this table. */
  | { type: "stitch"; table: SymbolTablePayload };

// --- Worker to main ----------------------------------------------------------

/** What a worker extracted from the files it was given, in the order it extracted them. */
export interface ExtractionResultPayload {
  strings: EncodedStrings;
  /** The file index of each extracted file, in extraction order. */
  fileIndices: Int32Array;
  /** How many node records each of those files contributed. */
  nodeCounts: Int32Array;
  /** `NODE_STRIDE` ints per node, grouped by file in `fileIndices` order. */
  nodes: Int32Array;
  /** How many symbol-entry records each of those files contributed. */
  entryCounts: Int32Array;
  /** `ENTRY_STRIDE` ints per entry, grouped like `nodes`. */
  entries: Int32Array;
}

export interface StitchedPayload {
  strings: EncodedStrings;
  /** `EDGE_STRIDE` ints per edge. */
  edges: Int32Array;
  /** Cross-source-root ambiguities this worker's files hit. */
  ambiguities: number;
}

export type FromWorker =
  /** The worker has loaded its parser and can take a file. */
  | { type: "ready" }
  /** One file is done. `errors` is empty when it extracted cleanly. */
  | { type: "extracted"; fileIndex: number; errors: ParseError[] }
  | { type: "extraction-result"; result: ExtractionResultPayload }
  | { type: "stitched"; result: StitchedPayload }
  /** The worker hit something it cannot continue from. */
  | { type: "failed"; message: string };

// --- Codecs ------------------------------------------------------------------

/** Append `node` to a growing flat record list, interning its strings. */
export function encodeNode(node: GraphNode, strings: StringTableBuilder, out: number[]): void {
  const kind = NODE_KIND_CODES[node.kind as keyof typeof NODE_KIND_CODES];
  if (kind === undefined) {
    throw new Error(`cannot encode a node of kind "${node.kind}"`);
  }
  out.push(
    strings.intern(node.id),
    kind,
    node.packagePath === undefined ? -1 : strings.intern(node.packagePath),
    strings.intern(node.directoryPath),
    node.definedInFile === undefined ? -1 : strings.intern(node.definedInFile),
  );
}

/** Decode the nodes in `records[from * NODE_STRIDE .. to * NODE_STRIDE)`. */
export function decodeNodes(
  records: Int32Array,
  from: number,
  to: number,
  strings: readonly string[],
): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (let i = from; i < to; i += 1) {
    const base = i * NODE_STRIDE;
    const node: GraphNode = {
      id: strings[records[base] as number] as string,
      kind: NODE_KINDS[records[base + 1] as number] as GraphNode["kind"],
      directoryPath: strings[records[base + 3] as number] as string,
    };
    const packagePath = records[base + 2] as number;
    if (packagePath >= 0) {
      node.packagePath = strings[packagePath] as string;
    }
    const definedInFile = records[base + 4] as number;
    if (definedInFile >= 0) {
      node.definedInFile = strings[definedInFile] as string;
    }
    nodes.push(node);
  }
  return nodes;
}

/** Append a symbol entry to a flat record list, interning its strings. */
export function encodeEntry(entry: SymbolEntry, strings: StringTableBuilder, out: number[]): void {
  out.push(
    strings.intern(entry.id),
    strings.intern(entry.key),
    strings.intern(entry.scope),
    ENTRY_KIND_CODES[entry.kind],
  );
}

/** Decode the symbol entries in `records[from * ENTRY_STRIDE .. to * ENTRY_STRIDE)`. */
export function decodeEntries(
  records: Int32Array,
  from: number,
  to: number,
  strings: readonly string[],
): SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  for (let i = from; i < to; i += 1) {
    const base = i * ENTRY_STRIDE;
    entries.push({
      id: strings[records[base] as number] as string,
      key: strings[records[base + 1] as number] as string,
      scope: strings[records[base + 2] as number] as string,
      kind: ENTRY_KINDS[records[base + 3] as number] as SymbolEntry["kind"],
    });
  }
  return entries;
}

/** Encode edges into a string table and flat records. */
export function encodeEdges(edges: readonly DependencyEdge[]): { strings: EncodedStrings; records: Int32Array } {
  const strings = new StringTableBuilder();
  const records = new Int32Array(edges.length * EDGE_STRIDE);
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i] as DependencyEdge;
    const base = i * EDGE_STRIDE;
    records[base] = strings.intern(edge.source);
    records[base + 1] = strings.intern(edge.target);
    records[base + 2] = edge.importFrequency;
    records[base + 3] = edge.methodCallFrequency;
    records[base + 4] = edge.sharedTypeCount;
  }
  return { strings: strings.encode(), records };
}

/** Decode edges produced by {@link encodeEdges}. */
export function decodeEdges(strings: EncodedStrings, records: Int32Array): DependencyEdge[] {
  const table = decodeStrings(strings);
  const edges: DependencyEdge[] = [];
  for (let base = 0; base < records.length; base += EDGE_STRIDE) {
    edges.push({
      source: table[records[base] as number] as string,
      target: table[records[base + 1] as number] as string,
      importFrequency: records[base + 2] as number,
      methodCallFrequency: records[base + 3] as number,
      sharedTypeCount: records[base + 4] as number,
    });
  }
  return edges;
}

/** Encode a canonical-order entry list into the shared-memory table every worker reads. */
export function encodeSymbolTable(entries: readonly SymbolEntry[]): SymbolTablePayload {
  const strings = new StringTableBuilder();
  const flat: number[] = [];
  for (const entry of entries) {
    encodeEntry(entry, strings, flat);
  }
  const shared = new Int32Array(new SharedArrayBuffer(flat.length * Int32Array.BYTES_PER_ELEMENT));
  shared.set(flat);
  return { strings: strings.encode(true), entries: shared };
}

/** Decode a table encoded by {@link encodeSymbolTable}. */
export function decodeSymbolTable(table: SymbolTablePayload): SymbolEntry[] {
  const strings = decodeStrings(table.strings);
  return decodeEntries(table.entries, 0, table.entries.length / ENTRY_STRIDE, strings);
}
