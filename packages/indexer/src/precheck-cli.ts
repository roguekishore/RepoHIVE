// The thread pool is sized before anything else loads (see thread-pool.ts).
import "./thread-pool.js";
import { parseArgs } from "node:util";
import { getViewsVersion } from "@repohive/views";
import type { FetchFunction } from "./github.js";
import { createLocalPrecheckFetch } from "./local-fixtures.js";
import { precheck } from "./precheck.js";

/**
 * The pre-check as a command, run by the server:
 *
 *   node dist/precheck-cli.js --repo <text> [--local-fixtures <tarball cache dir>]
 *
 * Prints the `PrecheckResult` as one JSON line on stdout. Exit code 0 for an accepted or a rejected
 * pre-check; 1 only on a crash, with the message on stderr. The GitHub token comes from
 * `REPOHIVE_GITHUB_TOKEN` (default `local-stub`). With `--local-fixtures`, `local/<name>` repositories are
 * answered from the fixture tarballs; other owners go to GitHub.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      "local-fixtures": { type: "string" },
    },
  });
  if (values.repo === undefined || values.repo.trim() === "") {
    throw new Error("--repo is required");
  }
  const token = process.env.REPOHIVE_GITHUB_TOKEN?.trim() || "local-stub";
  const fixtures = values["local-fixtures"];
  const doFetch: FetchFunction | undefined = fixtures === undefined ? undefined : createLocalPrecheckFetch(fixtures);
  const result = await precheck(values.repo, {
    token,
    viewsVersion: getViewsVersion(),
    ...(doFetch === undefined ? {} : { fetch: doFetch }),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
