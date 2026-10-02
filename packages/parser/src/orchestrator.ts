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
 * 3. **Prefetch** the collected files into memory, reading up to
 *    {@link ParseOptions.concurrency} of them at a time. Purely an I/O step: it
 *    produces a path-keyed map and decides nothing.
 * 4. **Extract** nodes and references from each file *in canonical order*,
 *    appending recoverable per-file errors (`file-unreadable`,
 *    `file-unparseable`) to a {@link ParseErrorCollector} and continuing. No
 *    output is written during this phase (R10.1, R10.2, R10.3).
 * 5. **Build the symbol table** then **stitch** edges over the full extracted
 *    node set (R4, R5, R6).
 * 6. **Gate on the collector.** If any recoverable error was recorded, return
 *    them all and write nothing — no partial or empty `graph.json`, and any
 *    prior valid file is left byte-for-byte intact because the serializer is
 *    never invoked (R10.4, R10.6).
 * 7. Otherwise **serialize** the graph atomically and return the
 *    {@link ParseSuccess} (R7, R8, R9).
 *
 * Writing is deferred until every file has been parsed (R10.3): the serializer
 * is only reached after the extract loop completes and the error gate passes.
 *
 * On success the {@link ParseSuccess} also carries the written graph in memory
 * (`graph`), so an in-process consumer can skip reading `graph.json` back. The
 * file is written either way.
 *
 * The prefetch (step 3) exists because per-file read *latency*, not compute,
 * dominates a cold parse: measured 2026-08-27 over 2985 files, sequential reads
 * took 59.06 s and sixteen-at-a-time took 8.64 s, while the directory walk cost
 * the same either way. It cannot affect output. The extraction loop still walks
 * `files` in canonical order and merely finds the bytes already in memory, so
 * neither the concurrency value nor the order the reads completed in can reach
 * any result: determinism here is structural, not a property being tested for.
 *
 * All collaborators are injected via {@link ParseDeps} so the error-gate
 * behavior can be tested deterministically without touching the real
 * filesystem or the Tree-Sitter runtime; the defaults wire the real pipeline
 * components.
 */

import * as nodeFs from "node:fs/promises";
import * as path from "node:path";

import type { DependencyEdge, GraphNode } from "@repohive/shared";

import {
  ParseErrorCollector,
  err,
  makeError,
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
 * Default number of source files read concurrently by the prefetch.
 *
 * Fixed, and deliberately NOT derived from `os.cpus().length`: the bottleneck
 * is per-file read latency, not compute, so core count is the wrong predictor.
 * The measured curve (2026-08-27, 2985 files) is flat past the knee (1: 59.06 s,
 * 16: 8.64 s, 64: 8.95 s), so overshooting costs a few percent while
 * undershooting costs several hundred. Sixteen sits comfortably past the knee
 * on every machine measured; there is nothing further to tune.
 */
const DEFAULT_READ_CONCURRENCY = 16;

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
  /**
   * Whether to write `graph.json`. Defaults to `true`. With `false` nothing is
   * written (no file, no temp file), `outputPath` is ignored and absent from the
   * result, and the graph is returned in memory on `ParseSuccess.graph` - the
   * same document, in the same order, that would have been written.
   */
  writeGraph?: boolean;
  /**
   * Directory-name segments to exclude from collection (Fix 16 — Gap 19).
   * Omitted → the collector's default list; an empty set → include everything
   * (`--include-generated`).
   */
  excludedSegments?: ReadonlySet<string>;
  /**
   * How many source files the prefetch reads at a time. Omitted →
   * {@link DEFAULT_READ_CONCURRENCY} (16); `1` → a strictly sequential
   * prefetch.
   *
   * A performance knob only. It cannot change what is produced: the value is
   * consumed entirely inside the read step, and extraction runs afterwards in
   * canonical order over the in-memory map. A value that is not an integer >= 1
   * falls back to the default rather than failing the parse; callers that want
   * a nonsense value rejected validate before calling (the engine does exactly
   * that, and reports `INVALID_OPTIONS` before any work starts).
   *
   * Memory: the prefetch holds every collected file's text at once. That is
   * 13.4 MB for the 2985-file reference project; a bounded read-ahead is the
   * recorded follow-up for repositories far larger than that.
   */
  concurrency?: number;
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
  /**
   * Build the extractor over the prefetched sources. The argument is the
   * synchronous reader the orchestrator wants the extractor to use: it serves
   * from the in-memory prefetch map and throws for any file the prefetch could
   * not read, which is what routes such a file into the extractor's existing
   * `file-unreadable` branch.
   */
  createExtractor: (
    readFile: (absolutePath: string) => string,
  ) => Promise<AstExtractor>;
  symbolTableBuilder: SymbolTableBuilder;
  stitcher: Stitcher;
  serializer: GraphSerializer;
  /**
   * Read one source file for the prefetch. Optional; omit for
   * `node:fs/promises`. Injected in tests to observe read concurrency and to
   * simulate read failures without touching the real filesystem.
   */
  readSource?: (absolutePath: string) => Promise<string>;
}

/** Read a source file from the real filesystem (the prefetch default). */
function defaultReadSource(absolutePath: string): Promise<string> {
  return nodeFs.readFile(absolutePath, "utf8");
}

/** Build the default pipeline collaborators wired to the real components. */
function defaultDeps(): ParseDeps {
  return {
    validator: createInputValidator(),
    collector: createSourceFileCollector(),
    createExtractor: (readFile) => createAstExtractor({ readFile }),
    symbolTableBuilder: createSymbolTableBuilder(),
    stitcher: createStitcher(),
    serializer: createGraphSerializer(),
    readSource: defaultReadSource,
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
 * Resolve the effective prefetch concurrency. Anything that is not an integer
 * >= 1 falls back to the default: the parser has no error category for a bad
 * performance knob, and refusing to parse over one would be a worse outcome
 * than ignoring it. Callers that want it rejected validate first.
 */
function resolveConcurrency(concurrency: number | undefined): number {
  if (
    concurrency === undefined ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1
  ) {
    return DEFAULT_READ_CONCURRENCY;
  }
  return concurrency;
}

/**
 * Read every collected file into memory, at most `concurrency` at a time.
 *
 * Pure I/O: a path-keyed map is the whole result, and nothing here inspects
 * ordering. Workers pull from a shared cursor, so the reads complete in
 * whatever order the filesystem returns them, which is exactly why the map is
 * keyed by path and never iterated.
 *
 * A read failure is deliberately swallowed. Leaving the entry absent defers the
 * report to the extraction loop, which walks files in canonical order and
 * records `file-unreadable` through the same branch a direct read failure has
 * always taken. Recording it here instead would both change the error shape and
 * make the error ORDER depend on read completion order.
 */
async function prefetchSources(
  files: readonly CollectedFile[],
  concurrency: number,
  readSource: (absolutePath: string) => Promise<string>,
): Promise<Map<string, string>> {
  const sources = new Map<string, string>();
  if (files.length === 0) {
    return sources;
  }

  let next = 0;
  const readNext = async (): Promise<void> => {
    for (;;) {
      // No `await` between the read and the increment, so the cursor cannot be
      // handed to two workers.
      const index = next;
      next += 1;
      if (index >= files.length) {
        return;
      }
      const file = files[index]!;
      try {
        sources.set(file.absolutePath, await readSource(file.absolutePath));
      } catch {
        // Absent entry; see the docstring.
      }
    }
  };

  const workers = Math.min(concurrency, files.length);
  await Promise.all(Array.from({ length: workers }, () => readNext()));
  return sources;
}

/**
 * The synchronous reader the extractor is built with: serve the prefetched
 * text, and throw when it is absent.
 *
 * Throwing is the point. `AstExtractor.extract` is synchronous by design and
 * already catches its reader's throw to record `file-unreadable` and continue,
 * so a file the prefetch could not read produces exactly the error a direct
 * read failure produced before the prefetch existed: same reason, same
 * message, same path, recorded at the same point in canonical order.
 */
function createMemoryReader(
  sources: ReadonlyMap<string, string>,
): (absolutePath: string) => string {
  return (absolutePath) => {
    const source = sources.get(absolutePath);
    if (source === undefined) {
      throw new Error(`Source was not prefetched: ${absolutePath}`);
    }
    return source;
  };
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
  try {
    return await parseProjectUnguarded(options, deps);
  } catch (cause) {
    // Backstop (Fix 2 — Gap 3): the parser promises errors-as-values, so no
    // throw may cross this boundary. Anything unexpected becomes a structured
    // error rather than a raw stack trace; nothing is written, because the
    // serializer is the last step and any throw precedes its completion.
    return err([
      makeError(
        "internal-error",
        `Unexpected internal error while parsing: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    ]);
  }
}

async function parseProjectUnguarded(
  options: ParseOptions,
  deps: ParseDeps,
): Promise<Result<ParseSuccess, ParseError>> {
  // 1. Validate the project directory; a fatal input error short-circuits with
  //    exactly one error and no further work (R1, R1.7).
  const validation = await deps.validator.validate(options.projectDirectory);
  if (!validation.ok) {
    return validation;
  }
  const validated = validation.value;

  // Recoverable errors are recorded from collection onward: an unrepresentable
  // path is found during the walk, before extraction begins.
  const errors = new ParseErrorCollector();

  // 2. Collect Java source files in canonical order; fatal collection errors
  //    (unreadable directory, no `.java` files) are returned immediately
  //    (R2.4, R2.5).
  let excludedDirectoryCount = 0;
  const collection = await deps.collector.collect(validated, {
    excludedSegments: options.excludedSegments,
    onExcludedDirectory: () => {
      excludedDirectoryCount += 1;
    },
    onUnsupportedPath: (error) => {
      errors.add(error);
    },
  });
  if (!collection.ok) {
    return collection;
  }
  const files: CollectedFile[] = collection.value;

  // 3. Prefetch the collected files concurrently into memory. Reads dominate a
  //    cold parse and parallelize about 6.8x; nothing downstream can observe
  //    the concurrency, because the loop below is unchanged and still drives
  //    the canonical order (see the module docstring).
  const sources = await prefetchSources(
    files,
    resolveConcurrency(options.concurrency),
    deps.readSource ?? defaultReadSource,
  );

  // 4. Extract nodes + references from every file in canonical order,
  //    accumulating recoverable per-file errors and continuing (R10.1, R10.2).
  //    No output is written during this phase (R10.3).
  const extractor = await deps.createExtractor(createMemoryReader(sources));

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

  // 5. Build the symbol table then stitch edges over the full node set
  //    (R4, R5, R6). These run even when errors were recorded so behavior stays
  //    uniform, but their output is discarded by the gate below when needed.
  const symbols = deps.symbolTableBuilder.build(nodes);
  // Count cross-source-root resolution ambiguities so the run can report them
  // (Fix 24 — Gap 2); each was resolved deterministically to the byte-first
  // candidate, so this is an audit signal, not an error.
  let crossScopeAmbiguities = 0;
  const edges: DependencyEdge[] = deps.stitcher.stitch(
    nodes,
    references,
    symbols,
    () => {
      crossScopeAmbiguities += 1;
    },
  );

  // 6. Error gate: if any recoverable error was recorded, return them all and
  //    write nothing. The serializer is never invoked, so no partial/empty
  //    `graph.json` is created and any prior valid file is left byte-for-byte
  //    intact (R10.4, R10.6).
  if (errors.hasErrors()) {
    return err(errors.errors());
  }

  // 7. Serialize atomically and return success (R7, R8, R9).
  const outputPath =
    options.writeGraph === false
      ? undefined
      : resolveOutputPath(validated, options.outputPath);
  const written = await deps.serializer.write(nodes, edges, outputPath);
  if (written.ok) {
    if (crossScopeAmbiguities > 0) {
      written.value.crossScopeAmbiguities = crossScopeAmbiguities;
    }
    if (excludedDirectoryCount > 0) {
      written.value.excludedDirectoryCount = excludedDirectoryCount;
    }
  }
  return written;
}
