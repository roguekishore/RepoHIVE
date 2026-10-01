/**
 * Telemetry, config and job input.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ConfigError, loadConfig } from "./config.js";
import { parseJobInput } from "./job-input.js";
import { METRIC_NAMESPACE, STAGE_NAMES, createLogger, createTelemetry } from "./telemetry.js";

type Emf = {
  _aws: { Timestamp: number; CloudWatchMetrics: { Namespace: string; Dimensions: string[][]; Metrics: { Name: string; Unit: string }[] }[] };
  [key: string]: unknown;
};

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

describe("metrics", () => {
  test("every metric is an embedded-metric line in RepoHIVE/Hosted with only the allowed dimensions", () => {
    const { lines, write } = collect();
    const t = createTelemetry({ tier: "M", runtime: "lambda", write, now: () => 1_700_000_000_000 });
    t.jobSucceeded();
    t.jobFailed("user");
    for (const stage of STAGE_NAMES) t.stageMs(stage, 12.6);
    t.endToEndMs(1234.4);
    t.peakRssMb(512.2);

    const parsed = lines.map((line) => JSON.parse(line) as Emf);
    assert.equal(parsed.length, 2 + STAGE_NAMES.length + 2);
    const names = parsed.map((line) => line._aws.CloudWatchMetrics[0]!.Metrics[0]!.Name);
    assert.deepEqual([...new Set(names)].sort(), ["EndToEndMs", "JobsFailed", "JobsSucceeded", "PeakRssMb", "StageMs"]);

    const allowed = new Set(["Tier", "Runtime", "Class", "Stage"]);
    for (const line of parsed) {
      const directive = line._aws.CloudWatchMetrics[0]!;
      assert.equal(directive.Namespace, METRIC_NAMESPACE);
      assert.equal(line._aws.Timestamp, 1_700_000_000_000);
      for (const dimension of directive.Dimensions[0]!) {
        assert.ok(allowed.has(dimension), dimension);
        assert.equal(typeof line[dimension], "string");
      }
      // Only the dimensions, the metric and `_aws`: nothing else can carry a repo, URL, account or IP.
      const metric = directive.Metrics[0]!.Name;
      assert.deepEqual(Object.keys(line).sort(), ["_aws", metric, ...directive.Dimensions[0]!].sort());
    }
    const failed = parsed.find((line) => "JobsFailed" in line)!;
    assert.deepEqual(failed._aws.CloudWatchMetrics[0]!.Dimensions, [["Tier", "Runtime", "Class"]]);
    assert.equal(failed.Class, "user");
    const stage = parsed.filter((line) => "StageMs" in line).map((line) => line.Stage);
    assert.deepEqual(stage, ["fetch", "parse", "group", "views", "publish"]);
    assert.equal(parsed.find((line) => "StageMs" in line)!.StageMs, 13);
  });
});

describe("logs", () => {
  test("every line is JSON with the job id, and caller fields cannot override it", () => {
    const { lines, write } = collect();
    const log = createLogger({ jobId: "job-7", write, now: () => 0 });
    log.log("info", "hello", { count: 3, jobId: "other", level: "debug" });
    const line = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(line.jobId, "job-7");
    assert.equal(line.level, "info");
    assert.equal(line.message, "hello");
    assert.equal(line.count, 3);
    assert.equal(line.time, "1970-01-01T00:00:00.000Z");
  });

  test("a token never appears, whether named by key or hidden in a value", () => {
    const { lines, write } = collect();
    const token = "ghp_exampleTokenValue1234567890";
    const log = createLogger({ jobId: "j", secrets: [token], write });
    log.log("error", `request failed with Authorization: Bearer ${token}`, {
      githubToken: token,
      Authorization: `Bearer ${token}`,
      error: `HTTP 401 for ${token}`,
      nested: { a: token },
    });
    assert.ok(!lines[0]!.includes(token));
    assert.ok(lines[0]!.includes("[redacted]"));
  });
});

describe("configuration", () => {
  const base = { REPOHIVE_RUNTIME: "local", REPOHIVE_STORE: "local:/tmp/store", REPOHIVE_LEDGER: "memory" };

  test("reads a local configuration without a token", () => {
    const config = loadConfig(base);
    assert.deepEqual(config.store, { kind: "local", directory: "/tmp/store" });
    assert.deepEqual(config.ledger, { kind: "memory" });
    assert.equal(config.githubToken, undefined);
    assert.equal(config.runtime, "local");
  });

  test("reads the AWS forms", () => {
    const config = loadConfig({
      REPOHIVE_RUNTIME: "fargate",
      REPOHIVE_STORE: "s3:my-bucket",
      REPOHIVE_LEDGER: "dynamodb:jobs",
      REPOHIVE_GITHUB_TOKEN: "t0ken",
      AWS_REGION: "ap-south-1",
    });
    assert.deepEqual(config.store, { kind: "s3", bucket: "my-bucket" });
    assert.deepEqual(config.ledger, { kind: "dynamodb", table: "jobs" });
    assert.equal(loadConfig({ ...base, REPOHIVE_LEDGER: "file:/tmp/l.json" }).ledger.kind, "file");
  });

  test("rejects a missing or malformed variable by name, without echoing the token", () => {
    const rejects = (env: NodeJS.ProcessEnv, pattern: RegExp): void =>
      assert.throws(() => loadConfig(env), (error) => error instanceof ConfigError && pattern.test(error.message));
    rejects({ ...base, REPOHIVE_RUNTIME: undefined }, /REPOHIVE_RUNTIME is not set/);
    rejects({ ...base, REPOHIVE_RUNTIME: "ec2" }, /REPOHIVE_RUNTIME must be/);
    rejects({ ...base, REPOHIVE_STORE: "ftp:x" }, /REPOHIVE_STORE must be/);
    rejects({ ...base, REPOHIVE_STORE: "s3:" }, /REPOHIVE_STORE must be/);
    rejects({ ...base, REPOHIVE_LEDGER: "redis:x" }, /REPOHIVE_LEDGER must be/);
    rejects({ ...base, REPOHIVE_RUNTIME: "lambda" }, /REPOHIVE_GITHUB_TOKEN is not set/);
    rejects({ ...base, REPOHIVE_STORE: "s3:b" }, /AWS_REGION is not set/);
    assert.throws(
      () => loadConfig({ ...base, REPOHIVE_RUNTIME: "lambda", REPOHIVE_STORE: "bogus", REPOHIVE_GITHUB_TOKEN: "sekrit-token" }),
      (error) => !(error as Error).message.includes("sekrit-token"),
    );
  });
});

describe("job input", () => {
  const good = {
    jobId: "j1",
    accountId: "a1",
    repo: "github.com/acme/widgets",
    commitSha: "a".repeat(40),
    tier: "L",
    snapshotId: "b".repeat(32),
    visibility: "public",
  };

  test("accepts a complete input", () => {
    assert.deepEqual(parseJobInput(good), good);
  });

  test("rejects anything else, naming the field", () => {
    assert.throws(() => parseJobInput(null), /must be an object/);
    assert.throws(() => parseJobInput({ ...good, tier: "XXL" }), /tier/);
    assert.throws(() => parseJobInput({ ...good, visibility: "private" }), /visibility/);
    assert.throws(() => parseJobInput({ ...good, jobId: "" }), /jobId/);
    assert.throws(() => parseJobInput({ ...good, repo: 7 }), /repo/);
  });
});
