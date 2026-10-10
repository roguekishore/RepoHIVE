// The thread pool is sized before anything else loads (see thread-pool.ts).
import "./thread-pool.js";
import { parseArgs } from "node:util";
import { createLocalArtifactStore } from "./artifact-store-local.js";
import type { Tier } from "./job-types.js";
import { runLocal } from "./local-run.js";

/**
 * The local dev command:
 *
 *   node dist/cli.js --tarball <file.tar.gz> --repo <owner>/<repo> --commit <40-hex sha> --store <dir>
 *                    [--tier S|M|L|XL] [--time-limit-ms <n>]
 *
 * Runs the pre-check (GitHub stubbed from the tarball) and then `runJob` with
 * the local fetcher, a directory store and a memory reporter. Prints the
 * outcome as one JSON line after the job's own metric and log lines. Exit code:
 * 0 for a published snapshot, a cache hit or a retier, 1 otherwise.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      tarball: { type: "string" },
      repo: { type: "string" },
      commit: { type: "string" },
      store: { type: "string" },
      tier: { type: "string" },
      "time-limit-ms": { type: "string" },
    },
  });
  const need = (name: "tarball" | "repo" | "commit" | "store"): string => {
    const value = values[name];
    if (value === undefined || value === "") {
      throw new Error(`--${name} is required`);
    }
    return value;
  };
  const tier = values.tier as Tier | undefined;
  if (tier !== undefined && !["S", "M", "L", "XL"].includes(tier)) {
    throw new Error("--tier must be S, M, L or XL");
  }
  const outcome = await runLocal({
    tarballPath: need("tarball"),
    repo: need("repo"),
    commitSha: need("commit"),
    store: createLocalArtifactStore(need("store")),
    ...(tier === undefined ? {} : { tier }),
    ...(values["time-limit-ms"] === undefined ? {} : { timeLimitMs: Number(values["time-limit-ms"]) }),
  });
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  if (outcome.kind === "rejected") return 1;
  if (outcome.kind === "ran" && outcome.result.status === "failed") return 1;
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
