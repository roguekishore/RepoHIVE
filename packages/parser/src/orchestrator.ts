/**
 * Orchestrator (Parser_System) and error aggregation (design: "Orchestrator
 * (Parser_System) and error aggregation (R10)").
 *
 * `parseProject` sequences the parser pipeline end-to-end and enforces the
 * error-gating and no-partial-output guarantees of R10:
 *
 * 1. **Validate** the project directory. On failure return the single
 *    {@link ParseError} and do no further work (R1, R1.7).
 * 2. **Collect** Java source files in canonical order. Fatal collection errors
 *    (`directory-unreadable`, `no-java-files`) are returned immediately
 *    (R2.4, R2.5).
 * 3. **Extract** nodes and references from each file *in canonical order*,
 *    appending recoverable per-file errors (`file-unreadable`,
 *    `file-unparseable`) to a {@link ParseErrorCollector} and continuing. No
 *    output is written during this phase (R10.1, R10.2, R10.3).
 * 4. **Build the symbol table** then **stitch** edges over the full extracted
 *    node set (R4, R5, R6).
 * 5. **Gate on the collector.** If any recoverable error was recorded, return
 *    them all and write nothing — no partial or empty `graph.json`, and any
 *    prior valid file is left byte-for-byte intact because the serializer is
 *    never invoked (R10.4, R10.6).
 * 6. Otherwise **serialize** the graph atomically and return the
 *    {@link ParseSuccess} (R7, R8, R9).
 *
 * Writing is deferred until every file has been parsed (R10.3): the serializer
 * is only reached after the extract loop completes and the error gate passes.
 *
 * All collaborators are injected via {@link ParseDeps} so the error-gate
 * behavior can be tested deterministically without touching the real
 * filesystem or the Tree-Sitter runtime; the defaults wire the real pipeline
 * components.
 */

import * as path from "node:path";

import type { DependencyEdge, GraphNode } from "@repohive/shared";

import {
  ParseErrorCollector,
  err,
  type ParseError,
  type ParseSuccess,
  type Result,
} from "./errors.js";
import type { CollectedFile, RawReference } from "./types.js";
import {
  createInputValidator,
  type InputValidator,
  type ValidatedPath,
} from "./input-validator.js";
import {
  createSourceFileCollector,
  type SourceFileCollector,
} from "./source-collector.js";
import { createAstExtractor, type AstExtractor } from "./ast-extractor.js";
import {
  createSymbolTableBuilder,
  type SymbolTableBuilder,
} from "./symbol-table.js";
import { createStitcher, type Stitcher } from "./stitcher.js";
import { createGraphSerializer, type GraphSerializer } from "./serializer.js";

/** The name of the sole persisted artifact (R8.1). */
const OUTPUT_FILE_NAME = "graph.json";

/**
 * Options for {@link parseProject} (design: "Orchestrator (Parser_System)").
 */
export interface ParseOptions {
  /** Path to the local Java project directory to parse. */
  projectDirectory: string;
  /**
   * Where to write `graph.json`. Defaults to
   * `<validated projectDirectory>/graph.json` (the validated absolute path is
   * used as the base so the output location is stable and OS-independent).
   */
  outputPath?: string;
}

/**
 * The pipeline collaborators the orchestrator depends on. All are injectable so
 * the sequencing and error-gate behavior can be tested in isolation; omit any
 * field to use the real component. {@link ParseDeps.createExtractor} is a
 * factory because {@link createAstExtractor} performs asynchronous one-time
 * initialization of the Tree-Sitter runtime.
 */
export interface ParseDeps {
  validator: InputValidator;
  collector: SourceFileCollector;
  createExtractor: () => Promise<AstExtractor>;
  symbolTableBuilder: SymbolTableBuilder;
  stitcher: Stitcher;
  serializer: GraphSerializer;
}

/** Build the default pipeline collaborators wired to the real components. */
function defaultDeps(): ParseDeps {
  return {
    validator: createInputValidator(),
    collector: createSourceFileCollector(),
    createExtractor: () => createAstExtractor(),
    symbolTableBuilder: createSymbolTableBuilder(),
    stitcher: createStitcher(),
    serializer: createGraphSerializer(),
  };
}

/**
 * Resolve the effective output path: the caller's `outputPath` when provided,
 * otherwise `graph.json` inside the validated project directory (R10 default,
 * design: `outputPath` default). Using the validated absolute path as the base
 * keeps the location stable regardless of the process working directory.
 */
function resolveOutputPath(
  validated: ValidatedPath,
  outputPath: string | undefined,
): string {
  if (outputPath !== undefined && outputPath.trim().length > 0) {
    return outputPath;
  }
  return path.join(validated.absolutePath, OUTPUT_FILE_NAME);
}

/**
 * Parse a Java project into a single contract-conforming `graph.json`.
 *
 * See the module docstring for the full sequence and the R10 gating rules.
 *
 * @param options the project directory and optional output path.
 * @param deps injectable pipeline collaborators (defaults to the real
 *   components).
 * @returns a {@link Result} carrying {@link ParseSuccess} on success, or the
 *   recorded {@link ParseError}s on failure (exactly one for fatal input
 *   failures, all recorded errors when any recoverable error occurred).
 */
export async function parseProject(
  options: ParseOptions,
  deps: ParseDeps = defaultDeps(),
): Promise<Result<ParseSuccess, ParseError>> {
  // 1. Validate the project directory; a fatal input error short-circuits with
  //    exactly one error and no further work (R1, R1.7).
  const validation = await deps.validator.validate(options.projectDirectory);
  if (!validation.ok) {
    return validation;
  }
  const validated = validation.value;

  // 2. Collect Java source files in canonical order; fatal collection errors
  //    (unreadable directory, no `.java` files) are returned immediately
  //    (R2.4, R2.5).
  const collection = await deps.collector.collect(validated);
  if (!collection.ok) {
    return collection;
  }
  const files: CollectedFile[] = collection.value;

  // 3. Extract nodes + references from every file in canonical order,
  //    accumulating recoverable per-file errors and continuing (R10.1, R10.2).
  //    No output is written during this phase (R10.3).
  const errors = new ParseErrorCollector();
  const extractor = await deps.createExtractor();

  const nodes: GraphNode[] = [];
  const references: RawReference[] = [];
  for (const file of files) {
    const extraction = extractor.extract(file, errors);
    if (extraction === null) {
      // A recoverable per-file error was recorded; continue with the rest.
      continue;
    }
    nodes.push(...extraction.nodes);
    references.push(...extraction.references);
  }

  // 4. Build the symbol table then stitch edges over the full node set
  //    (R4, R5, R6). These run even when errors were recorded so behavior stays
  //    uniform, but their output is discarded by the gate below when needed.
  const symbols = deps.symbolTableBuilder.build(nodes);
  const edges: DependencyEdge[] = deps.stitcher.stitch(nodes, references, symbols);

  // 5. Error gate: if any recoverable error was recorded, return them all and
  //    write nothing. The serializer is never invoked, so no partial/empty
  //    `graph.json` is created and any prior valid file is left byte-for-byte
  //    intact (R10.4, R10.6).
  if (errors.hasErrors()) {
    return err(errors.errors());
  }

  // 6. Serialize atomically and return success (R7, R8, R9).
  const outputPath = resolveOutputPath(validated, options.outputPath);
  return deps.serializer.write(nodes, edges, outputPath);
}
