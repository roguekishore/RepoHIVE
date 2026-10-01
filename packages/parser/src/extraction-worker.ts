/**
 * An extraction worker: the thread side of the two-phase pool.
 *
 * Phase 1: the pool hands it files one at a time. For each it decodes the bytes
 * the way a file read does, parses and extracts nodes and references, and keeps
 * both in its own heap. When the pool says the phase is over it sends back what
 * it extracted as compact records (nodes and symbol entries) and nothing else:
 * the references, which are by far the bulk, never leave the thread.
 *
 * Phase 2: it receives the merged symbol table once, read-only, and stitches the
 * files it extracted, so it resolves exactly the references it holds. A
 * reference's edge is keyed by its source, which lives in one of this worker's
 * files, so no two workers ever produce the same edge and nothing needs merging
 * but the lists.
 *
 * Nothing here decides an output byte: results are keyed by the file index the
 * pool assigned, and the pool assembles them in canonical order.
 */

import { parentPort } from "node:worker_threads";

import type { DependencyEdge, GraphNode } from "@repohive/shared";

import { createAstExtractor } from "./ast-extractor.js";
import { ParseErrorCollector, type ParseError } from "./errors.js";
import {
  ENTRY_STRIDE,
  NODE_STRIDE,
  decodeSymbolTable,
  encodeEdges,
  encodeEntry,
  encodeNode,
  type ExtractionResultPayload,
  type FromWorker,
  type StitchedPayload,
  type ToWorker,
} from "./extraction-protocol.js";
import { StringTableBuilder } from "./string-table.js";
import { stitch } from "./stitcher.js";
import { buildSymbolTableFromEntries, symbolEntryOf, type SymbolEntry } from "./symbol-table.js";
import type { RawReference } from "./types.js";

if (parentPort === null) {
  throw new Error("extraction-worker must run as a worker thread");
}
const port = parentPort;

function send(message: FromWorker, transfer: ArrayBufferLike[] = []): void {
  port.postMessage(message, transfer as ArrayBuffer[]);
}

/** What this worker kept for one file between the two phases. */
interface Extracted {
  fileIndex: number;
  nodes: GraphNode[];
  entries: SymbolEntry[];
  references: RawReference[];
}

/** Decode bytes exactly as `readFile(path, "utf8")` does (a byte-order mark is kept). */
function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
}

async function main(): Promise<void> {
  // The extractor's reader is a one-slot mailbox: the text of the file in hand.
  let current = "";
  const extractor = await createAstExtractor({ readFile: () => current });

  const kept: Extracted[] = [];

  const extractFile = (message: Extract<ToWorker, { type: "extract" }>): void => {
    current = decode(message.bytes);
    const errors = new ParseErrorCollector();
    const extraction = extractor.extract(
      { absolutePath: message.relativePath, relativePath: message.relativePath },
      errors,
    );
    current = "";
    if (extraction !== null && !errors.hasErrors()) {
      const entries: SymbolEntry[] = [];
      for (const node of extraction.nodes) {
        const entry = symbolEntryOf(node);
        if (entry !== null) {
          entries.push(entry);
        }
      }
      kept.push({
        fileIndex: message.fileIndex,
        nodes: extraction.nodes,
        entries,
        references: extraction.references,
      });
    }
    send({ type: "extracted", fileIndex: message.fileIndex, errors: errors.errors() as ParseError[] });
  };

  const finishExtraction = (): void => {
    const strings = new StringTableBuilder();
    const nodeRecords: number[] = [];
    const entryRecords: number[] = [];
    const fileIndices = new Int32Array(kept.length);
    const nodeCounts = new Int32Array(kept.length);
    const entryCounts = new Int32Array(kept.length);
    kept.forEach((file, i) => {
      fileIndices[i] = file.fileIndex;
      nodeCounts[i] = file.nodes.length;
      entryCounts[i] = file.entries.length;
      for (const node of file.nodes) {
        encodeNode(node, strings, nodeRecords);
      }
      for (const entry of file.entries) {
        encodeEntry(entry, strings, entryRecords);
      }
    });
    const nodes = Int32Array.from(nodeRecords);
    const entries = Int32Array.from(entryRecords);
    if (nodes.length !== nodeCounts.reduce((a, b) => a + b, 0) * NODE_STRIDE) {
      throw new Error("node record count disagrees with per-file counts");
    }
    if (entries.length !== entryCounts.reduce((a, b) => a + b, 0) * ENTRY_STRIDE) {
      throw new Error("entry record count disagrees with per-file counts");
    }
    const encoded = strings.encode();
    const result: ExtractionResultPayload = {
      strings: encoded,
      fileIndices,
      nodeCounts,
      nodes,
      entryCounts,
      entries,
    };
    send({ type: "extraction-result", result }, [
      encoded.bytes.buffer,
      encoded.offsets.buffer,
      fileIndices.buffer,
      nodeCounts.buffer,
      nodes.buffer,
      entryCounts.buffer,
      entries.buffer,
    ]);
  };

  const stitchOwnFiles = (table: Extract<ToWorker, { type: "stitch" }>["table"]): void => {
    const symbols = buildSymbolTableFromEntries(decodeSymbolTable(table));
    const nodes: GraphNode[] = [];
    const references: RawReference[] = [];
    for (const file of kept) {
      for (const node of file.nodes) {
        nodes.push(node);
      }
      for (const reference of file.references) {
        references.push(reference);
      }
    }
    let ambiguities = 0;
    const edges: DependencyEdge[] = stitch(
      nodes,
      references,
      symbols,
      () => {
        ambiguities += 1;
      },
      (id) => symbols.kindOf(id),
    );
    const encoded = encodeEdges(edges);
    const result: StitchedPayload = { strings: encoded.strings, edges: encoded.records, ambiguities };
    send({ type: "stitched", result }, [
      encoded.strings.bytes.buffer,
      encoded.strings.offsets.buffer,
      encoded.records.buffer,
    ]);
  };

  port.on("message", (message: ToWorker) => {
    try {
      switch (message.type) {
        case "extract":
          extractFile(message);
          break;
        case "finish-extraction":
          finishExtraction();
          break;
        case "stitch":
          stitchOwnFiles(message.table);
          break;
      }
    } catch (cause) {
      send({ type: "failed", message: cause instanceof Error ? cause.message : String(cause) });
    }
  });

  send({ type: "ready" });
}

main().catch((cause: unknown) => {
  send({ type: "failed", message: cause instanceof Error ? cause.message : String(cause) });
});
