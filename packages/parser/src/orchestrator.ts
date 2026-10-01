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
 * 3. **Extract, resolve and stitch** through the {@link ExtractionPipeline}
 *    (default: a pool of worker threads, see `extraction-pool.ts`). Disk reads
 *    feed the pool, at most {@link ParseOptions.concurrency} in flight; an
 *    in-memory source feeds it from memory. Recoverable per-file errors
 *    (`file-unreadable`, `file-unparseable`) come back in canonical file order,
 *    and no output is written during this phase (R10.1, R10.2, R10.3).
 * 4. **Gate on the collector.** If any recoverable error was recorded, return
 *    them all and write nothing — no partial or empty `graph.json`, and any
 *    prior valid file is left byte-for-byte intact because the serializer is
 *    never invoked (R10.4, R10.6).
 * 5. Otherwise **serialize** the graph atomically and return the
 *    {@link ParseSuccess} (R7, R8, R9).
 *
 * Writing is deferred until every file has been parsed (R10.3): the serializer
 * is only reached after the pipeline completes and the error gate passes.
 *
 * On success the {@link ParseSuccess} also carries the written graph in memory
 * (`graph`), so an in-process consumer can skip reading `graph.json` back. The
 * file is written either way unless `writeGraph` is `false`.
 *
 * Reads dominate a cold parse (per-file latency, not compute): measured
 * 2026-08-27 over 2985 files, sequential reads took 59.06 s and
 * sixteen-at-a-time took 8.64 s. Neither the read concurrency, the worker count,
 * nor the order anything completes in can reach any result: the pipeline keys
 * every result by the file's index in the canonical list and assembles in that
 * order, so determinism here is structural, not a property being tested for.
 *
 * All collaborators are injected via {@link ParseDeps} so the error-gate
 * behavior can be tested deterministically without touching the real
 * filesystem or worker threads; the defaults wire the real pipeline components.
 */

import * as nodeFs from "node:fs/promises";
import { availableParallelism } from "node:os";
import * as path from "node:path";

import {
  ParseErrorCollector,
  err,
  makeError,
  type ParseError,
  type ParseSuccess,
  type Result,
} from "./errors.js";
import type { CollectedFile } from "./types.js";
import {
  createInputValidator,
  type InputValidator,
  type ValidatedPath,
} from "./input-validator.js";
import {
  createSourceFileCollector,
  type SourceFileCollector,
} from "./source-collector.js";
import {
  createWorkerPoolPipeline,
  type ExtractionPipeline,
  type FileSource,
} from "./extraction-pool.js";
import { createGraphSerializer, type GraphSerializer } from "./serializer.js";
import {
  findInvalidSourceEntry,
  selectMemorySource,
  type SourceEntry,
} from "./memory-source.js";

/** The name of the sole persisted artifact (R8.1). */
const OUTPUT_FILE_NAME = "graph.json";

/**
 * Default number of source files read from disk concurrently while the pool is fed.
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
  /**
   * Path to the local Java project directory to parse. Give this or
   * {@link ParseOptions.source}: when `source` is given it is used and this is
   * ignored (the engine, which validates exactly-one-of, is the layer that
   * rejects both or neither).
   */
  projectDirectory?: string;
  /**
   * The Java sources as in-memory entries, instead of a directory. They go
   * through the same selection policy as a directory walk and are decoded the
   * way a file read decodes them, so the same tree gives the same graph. No
   * source file is read from disk. A malformed list is a `source-invalid` error
   * before any work. With a memory source there is no project directory to
   * default the output path from, so `outputPath` is required unless
   * `writeGraph` is `false`.
   */
  source?: readonly SourceEntry[];
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
   * How many source files are being read from disk at once while the pool is
   * fed. Omitted → {@link DEFAULT_READ_CONCURRENCY} (16); `1` → strictly
   * sequential reads. Has no effect on a memory source.
   *
   * A performance knob only. It cannot change what is produced: the value is
   * consumed entirely by the read scheduling, and every result is keyed by file
   * index and assembled in canonical order. A value that is not an integer >= 1
   * falls back to the default rather than failing the parse; callers that want
   * a nonsense value rejected validate before calling (the engine does exactly
   * that, and reports `INVALID_OPTIONS` before any work starts).
   *
   * Memory: reads ahead of the workers are bounded (the in-flight reads plus
   * twice the worker count), so the corpus is never held whole.
   */
  concurrency?: number;
  /**
   * How many worker threads extract and stitch. Omitted → the machine's
   * available parallelism. At most one thread per file is started. A value that
   * is not an integer >= 1 falls back to the default, like `concurrency`; the
   * engine rejects it up front. Cannot change any output byte.
   */
  workers?: number;
  /**
   * Called while files are extracted, with how many have settled and how many
   * were selected. Never decreases; the last call has `completed === total`.
   * Not awaited and not throttled. Cannot change any output byte. A throw fails
   * the parse as `internal-error`.
   */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * The pipeline collaborators the orchestrator depends on. All are injectable so
 * the sequencing and error-gate behavior can be tested in isolation; the
 * defaults wire the real components.
 */
export interface ParseDeps {
  validator: InputValidator;
  collector: SourceFileCollector;
  /**
   * Extraction, symbol-table merge and stitching over the collected files.
   * Defaults to the worker-thread pool; tests inject a scripted pipeline.
   */
  pipeline: ExtractionPipeline;
  serializer: GraphSerializer;
  /**
   * Read one disk source file's bytes. Optional; omit for `node:fs/promises`.
   * Injected in tests to observe read concurrency and to simulate read failures
   * without touching the real filesystem.
   */
  readBytes?: (absolutePath: string) => Promise<Uint8Array>;
  /** Size of one disk source file, for largest-first scheduling. Optional; omit for `fs.stat`. */
  fileSize?: (absolutePath: string) => Promise<number>;
}

/** Read a source file's bytes from the real filesystem (the default). */
function defaultReadBytes(absolutePath: string): Promise<Uint8Array> {
  return nodeFs.readFile(absolutePath);
}

/** Stat a source file on the real filesystem (the default). */
async function defaultFileSize(absolutePath: string): Promise<number> {
  return (await nodeFs.stat(absolutePath)).size;
}

/** Build the default pipeline collaborators wired to the real components. */
function defaultDeps(): ParseDeps {
  return {
    validator: createInputValidator(),
    collector: createSourceFileCollector(),
    pipeline: createWorkerPoolPipeline(),
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
 * Resolve the effective read concurrency. Anything that is not an integer
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
 * Resolve the effective worker count. Same policy as the read concurrency: a
 * bad performance knob is not worth failing a parse over.
 */
function resolveWorkers(workers: number | undefined): number {
  if (workers === undefined || !Number.isSafeInteger(workers) || workers < 1) {
    return Math.max(1, availableParallelism());
  }
  return workers;
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
  // Recoverable errors are recorded from collection onward: an unrepresentable
  // path is found during the walk, before extraction begins.
  const errors = new ParseErrorCollector();

  let validated: ValidatedPath | undefined;
  let files: CollectedFile[];
  let source: FileSource;
  let excludedDirectoryCount = 0;

  if (options.source !== undefined) {
    // 1-2 (memory). No directory, no walk, no reads: select and keep the bytes.
    const problem = findInvalidSourceEntry(options.source);
    if (problem !== undefined) {
      return err([
        makeError(
          "source-invalid",
          `Source entry ${problem.index}${problem.path !== undefined ? ` (${problem.path})` : ""}: ${problem.problem}`,
          problem.path,
        ),
      ]);
    }
    const selection = selectMemorySource(options.source, {
      excludedSegments: options.excludedSegments,
    });
    for (const unsupported of selection.unsupported) {
      errors.add(unsupported);
    }
    if (selection.files.length === 0) {
      return err([
        makeError(
          "no-java-files",
          "No Java source files were found in the in-memory source.",
        ),
      ]);
    }
    files = selection.files;
    excludedDirectoryCount = selection.excludedDirectoryCount;
    const bytes = selection.bytes;
    const entryOf = (file: CollectedFile): Uint8Array => {
      const entry = bytes.get(file.absolutePath);
      if (entry === undefined) {
        throw new Error(`Source was not provided: ${file.absolutePath}`);
      }
      return entry;
    };
    source = {
      size: async (file) => entryOf(file).byteLength,
      // A copy: the pipeline transfers what it is given, and the caller's
      // buffers must stay theirs.
      read: async (file) => entryOf(file).slice(),
    };
  } else {
    // 1. Validate the project directory; a fatal input error short-circuits
    //    with exactly one error and no further work (R1, R1.7).
    const validation = await deps.validator.validate(options.projectDirectory);
    if (!validation.ok) {
      return validation;
    }
    validated = validation.value;

    // 2. Collect Java source files in canonical order; fatal collection errors
    //    (unreadable directory, no `.java` files) are returned immediately
    //    (R2.4, R2.5).
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
    files = collection.value;
    const readBytes = deps.readBytes ?? defaultReadBytes;
    const fileSize = deps.fileSize ?? defaultFileSize;
    source = {
      size: (file) => fileSize(file.absolutePath),
      read: (file) => readBytes(file.absolutePath),
    };
  }

  // 3-5. Extract nodes and references from every file, build the symbol table,
  //    stitch edges. Recoverable per-file errors come back in canonical file
  //    order, after any the collector already recorded; no output is written
  //    during this phase (R10.1, R10.2, R10.3).
  const extraction = await deps.pipeline.run({
    files,
    source,
    workers: resolveWorkers(options.workers),
    readConcurrency: resolveConcurrency(options.concurrency),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
  });
  if (!extraction.ok) {
    return err([...errors.errors(), ...extraction.errors]);
  }
  const { nodes, edges, crossScopeAmbiguities } = extraction.value;

  // 6. Error gate: if any recoverable error was recorded, return them all and
  //    write nothing. The serializer is never invoked, so no partial/empty
  //    `graph.json` is created and any prior valid file is left byte-for-byte
  //    intact (R10.4, R10.6).
  if (errors.hasErrors()) {
    return err(errors.errors());
  }

  // 7. Serialize atomically and return success (R7, R8, R9).
  let outputPath: string | undefined;
  if (options.writeGraph !== false) {
    if (validated !== undefined) {
      outputPath = resolveOutputPath(validated, options.outputPath);
    } else if (options.outputPath !== undefined && options.outputPath.trim().length > 0) {
      outputPath = options.outputPath;
    } else {
      return err([
        makeError(
          "output-unwritable",
          "An in-memory source has no project directory to default the output path from; pass outputPath, or set writeGraph to false.",
        ),
      ]);
    }
  }
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
