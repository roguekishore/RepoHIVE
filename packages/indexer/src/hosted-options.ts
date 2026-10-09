/**
 * The engine options a hosted run uses: the engine defaults, with `source`,
 * `writeGraph: false`, `workers`, `outputDirectory` and `tolerateFileErrors` set. A public repository is
 * arbitrary input (templates, fuzz inputs, syntax newer than the grammar), so a file that will not parse
 * is skipped and counted rather than failing the whole repository.
 */
import { availableParallelism } from "node:os";
import { configDigest, type EngineOptions, type SourceEntry } from "@repohive/engine";

export function hostedEngineOptions(source: readonly SourceEntry[], outputDirectory: string): EngineOptions {
  return { source, writeGraph: false, workers: availableParallelism(), outputDirectory, tolerateFileErrors: true };
}

/** The `configDigest` of the hosted options. None of the five set options is in the digest, so this is the defaults' digest. */
export function hostedConfigDigest(): string {
  return configDigest(hostedEngineOptions([], ""));
}
