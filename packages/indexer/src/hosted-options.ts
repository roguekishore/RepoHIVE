/**
 * The engine options a hosted run uses: the engine defaults, with `source`,
 * `writeGraph: false`, `workers` and `outputDirectory` set.
 */
import { availableParallelism } from "node:os";
import { configDigest, type EngineOptions, type SourceEntry } from "@repohive/engine";

export function hostedEngineOptions(source: readonly SourceEntry[], outputDirectory: string): EngineOptions {
  return { source, writeGraph: false, workers: availableParallelism(), outputDirectory };
}

/** The `configDigest` of the hosted options. None of the four set options is in the digest, so this is the defaults' digest. */
export function hostedConfigDigest(): string {
  return configDigest(hostedEngineOptions([], ""));
}
