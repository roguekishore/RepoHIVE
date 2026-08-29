/**
 * Determinism demo: run the full grouping pipeline N times over the
 * same graph.json and assert the emitted five-file index is byte-identical
 * (one SHA-256 over all five payloads, mirroring the parser determinism demo).
 *
 * usage: npm run demo:group-determinism [-- <graph.json | dir> [runs]]
 * (defaults to fixtures/sample-java-project/graph.json)
 */

import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { stableStringify } from "./canonical.js";
import { describeError } from "./errors.js";
import { INDEX_FILE_NAMES, indexFilePayloads } from "./index-serializer.js";
import { groupGraph, readGraphFile } from "./orchestrator.js";
import { compareRunDigests, MIN_RUNS, validateRuns } from "./determinism-check.js";

function resolveAgainstInvocationDir(path: string): string {
  if (isAbsolute(path)) {
    return path;
  }
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

const inputArg = process.argv[2] ?? "fixtures/sample-java-project";

const runsInput = validateRuns(process.argv[3]);
if (!runsInput.ok) {
  console.error(`demo: ${runsInput.message}`);
  console.error(`usage: npm run demo:group-determinism -- <graph.json | dir> [runs>=${MIN_RUNS}]`);
  process.exit(2);
}
const runs = runsInput.runs;

let graphPath = resolveAgainstInvocationDir(inputArg);
try {
  if (statSync(graphPath).isDirectory()) {
    graphPath = join(graphPath, "graph.json");
  }
} catch {
  console.error(`demo: path not found: ${graphPath}`);
  process.exit(2);
}

const graph = readGraphFile(graphPath);
if (!graph.ok) {
  console.error(`demo: ${describeError(graph.error)}`);
  process.exit(1);
}

const digests: string[] = [];
let summary = { nodes: 0, depth: 0, regions: 0 };
for (let i = 0; i < runs; i++) {
  // Re-parse the input each run so no in-memory state can leak between runs.
  const freshGraph = readGraphFile(graphPath);
  if (!freshGraph.ok) {
    console.error(`demo: ${describeError(freshGraph.error)}`);
    process.exit(1);
  }
  const result = groupGraph(freshGraph.value);
  if (!result.ok) {
    console.error(`demo: ${describeError(result.error)}`);
    process.exit(1);
  }
  const payloads = indexFilePayloads(result.value.hierarchy, result.value.metadata);
  const hash = createHash("sha256");
  for (const name of INDEX_FILE_NAMES) {
    hash.update(name, "utf8");
    hash.update(stableStringify(payloads[name]), "utf8");
  }
  digests.push(hash.digest("hex"));
  summary = {
    nodes: result.value.metadata.nodeCount,
    depth: result.value.metadata.hierarchyDepth,
    regions: result.value.metadata.regionDecisions.length,
  };
}

const verdict = compareRunDigests(digests, runs);
console.log("RepoHIVE core — grouping determinism check");
console.log(`  input   : ${graphPath}`);
console.log(`  runs    : ${runs}`);
console.log(`  regions : ${summary.regions}`);
console.log(`  nodes   : ${summary.nodes} (depth ${summary.depth})`);
console.log(`  sha-256 : ${digests[0] ?? "(none produced)"}`);
console.log(
  `  result  : ${
    verdict.deterministic
      ? `DETERMINISTIC (${runs} runs, identical digest)`
      : `NON-DETERMINISTIC — ${verdict.reason}`
  }`,
);
if (!verdict.deterministic) {
  process.exit(1);
}
