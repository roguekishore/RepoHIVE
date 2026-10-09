/**
 * The local seed command: publishes the local
 * fixtures into the local artifact store through the job, under the
 * repo keys `local/<fixture>` (lowercase).
 *
 *   npm run seed --workspace @repohive/web [-- fixture ...]
 *
 * Fixtures default to every present one of `sample-java-project`, `jsoup`,
 * `vantage` and `BroadleafCommerce`. Each tarball is built offline with
 * `git archive`, using GitHub's codeload prefix `<owner>-<repo>-<sha>/`: from
 * the fixture's own repository when it has one, otherwise from the last commit
 * of this repository that touched it. A fixture in neither is skipped.
 * Re-seeding an unchanged fixture is a cache hit.
 *
 * Reads the app configuration (`config/local.env`, then `.env.local`) and
 * refuses to run outside local mode. Build the root first: this imports `dist/`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFileJobLedger, createLocalArtifactStore, runLocal } from "@repohive/indexer";
import { parseAppConfig } from "../src/server/hosting/config.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = ["sample-java-project", "jsoup", "vantage", "BroadleafCommerce"];

function git(args, cwd = repoRoot) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** The commit and tree-ish to archive, or `undefined` when the fixture is in no repository. */
function sourceOf(fixture) {
  const directory = path.join(repoRoot, "fixtures", fixture);
  if (existsSync(path.join(directory, ".git"))) {
    return { cwd: directory, commitSha: git(["rev-parse", "HEAD"], directory), treeish: "HEAD" };
  }
  const commitSha = git(["log", "-1", "--format=%H", "--", `fixtures/${fixture}`]);
  if (commitSha === "") {
    return undefined;
  }
  return { cwd: repoRoot, commitSha, treeish: `${commitSha}:fixtures/${fixture}` };
}

const config = parseAppConfig(process.env);
if (config.mode !== "local" || config.store.kind !== "local" || config.ledger.kind !== "file") {
  throw new Error("the seed command runs in local mode only");
}
mkdirSync(config.dataDirectory, { recursive: true });
mkdirSync(path.dirname(config.ledger.path), { recursive: true });
const store = createLocalArtifactStore(config.store.directory);
const ledger = createFileJobLedger({ path: config.ledger.path });

const requested = process.argv.slice(2);
for (const name of requested) {
  if (!FIXTURES.includes(name)) {
    throw new Error(`unknown fixture ${name}; known: ${FIXTURES.join(", ")}`);
  }
}
const fixtures = (requested.length > 0 ? requested : FIXTURES).filter((fixture) => {
  const present = existsSync(path.join(repoRoot, "fixtures", fixture));
  if (!present) console.log(`${fixture}: not present, skipped`);
  return present;
});

const scratch = mkdtempSync(path.join(tmpdir(), "repohive-seed-"));
let failed = 0;
try {
  for (const fixture of fixtures) {
    const source = sourceOf(fixture);
    if (source === undefined) {
      console.log(`${fixture}: not in a git repository, skipped`);
      continue;
    }
    const repoName = fixture.toLowerCase();
    const repo = `local/${repoName}`;
    const tarballPath = path.join(scratch, `${repoName}.tar.gz`);
    git(["archive", "--format=tar.gz", `--prefix=local-${repoName}-${source.commitSha}/`, "-o", tarballPath, source.treeish], source.cwd);
    const started = Date.now();
    const outcome = await runLocal({ tarballPath, repo, commitSha: source.commitSha, store, ledger, write: () => {} });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (outcome.kind === "rejected" || (outcome.kind === "ran" && outcome.result.status !== "succeeded")) {
      failed += 1;
      console.log(`${repo}: FAILED ${JSON.stringify(outcome)}`);
    } else {
      console.log(`${repo}: ${outcome.kind}, snapshot ${outcome.snapshotId}, commit ${source.commitSha.slice(0, 12)}, ${seconds} s`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exitCode = failed === 0 ? 0 : 1;
