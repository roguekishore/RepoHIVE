/**
 * The compiled pre-check CLI against the tracked sample fixture, through `--local-fixtures`.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("./precheck-cli.js", import.meta.url));
const cache = mkdtempSync(join(tmpdir(), "repohive-precheck-cli-"));
after(() => rmSync(cache, { recursive: true, force: true }));

async function exec(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args], { env: { ...process.env, REPOHIVE_GITHUB_TOKEN: "" } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

test("accepts the sample fixture and prints one JSON line", async () => {
  const { code, stdout } = await exec(["--repo", "local/sample-java-project", "--local-fixtures", cache]);
  assert.equal(code, 0);
  assert.equal(stdout.trimEnd().split("\n").length, 1);
  const result = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(result.ok, true);
  assert.equal(result.repo, "github.com/local/sample-java-project");
  assert.match(String(result.snapshotId), /^[0-9a-f]{32}$/);
  assert.match(String(result.commitSha), /^[0-9a-f]{40}$/);
  assert.equal(result.tier, "S");
  assert.equal(result.truncated, false);
  assert.ok(Number(result.javaFiles) >= 1);
  assert.ok(!("cacheHit" in result));
});

test("a rejected pre-check still exits 0 with the rejection on stdout", async () => {
  const { code, stdout } = await exec(["--repo", "local/no-such-fixture", "--local-fixtures", cache]);
  assert.equal(code, 0);
  const result = JSON.parse(stdout) as Record<string, unknown>;
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not-found");
  const invalid = await exec(["--repo", "not a repo", "--local-fixtures", cache]);
  assert.equal(invalid.code, 0);
  assert.equal((JSON.parse(invalid.stdout) as Record<string, unknown>).reason, "invalid-repository");
});

test("a missing --repo is a crash: exit 1, message on stderr, nothing on stdout", async () => {
  const { code, stdout, stderr } = await exec(["--local-fixtures", cache]);
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /--repo is required/);
});
