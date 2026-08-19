/**
 * TEMPORARY demo wrapper — `npm run group -- <graph.json | dir> [outDir]`.
 *
 * Same status as the parser's parse-cli: a temporary demo convenience,
 * replaced by the packaged CLI later (architecture
 * engine-vs-ecosystem line). Relative paths resolve against INIT_CWD so the
 * root `npm run group` script behaves like a plain command.
 */

import { statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { describeError } from "./errors.js";
import { groupGraphToIndex, readGraphFile } from "./orchestrator.js";

function resolveAgainstInvocationDir(path: string): string {
  if (isAbsolute(path)) {
    return path;
  }
  const base = process.env.INIT_CWD ?? process.cwd();
  return resolve(base, path);
}

const [, , inputArg, outArg] = process.argv;
if (!inputArg) {
  console.error("usage: npm run group -- <graph.json | project-dir> [outDir]");
  process.exit(2);
}

let graphPath = resolveAgainstInvocationDir(inputArg);
try {
  if (statSync(graphPath).isDirectory()) {
    graphPath = join(graphPath, "graph.json");
  }
} catch {
  console.error(`group: path not found: ${graphPath}`);
  process.exit(2);
}
const outDir = outArg ? resolveAgainstInvocationDir(outArg) : join(graphPath, "..", "index");

const graph = readGraphFile(graphPath);
if (!graph.ok) {
  console.error(`group: ${describeError(graph.error)}`);
  process.exit(1);
}

const result = groupGraphToIndex(graph.value, outDir);
if (!result.ok) {
  console.error(`group: ${describeError(result.error)}`);
  process.exit(1);
}

const { hierarchy, metadata } = result.value;
const preserved = metadata.regionDecisions.filter((d) => d.action === "preserve").length;
const reconstructed = metadata.regionDecisions.length - preserved;
console.log("RepoHIVE group — adaptive hierarchical grouping");
console.log(`  input    : ${graphPath}`);
console.log(`  regions  : ${metadata.regionDecisions.length} (preserve ${preserved} / reconstruct ${reconstructed})`);
console.log(`  boundary : ${metadata.structuralQualityBoundary}`);
console.log(`  nodes    : ${metadata.nodeCount} hierarchy nodes (depth ${hierarchy.depth})`);
console.log(`  edges    : ${hierarchy.leafEdges.length} leaf + ${hierarchy.crossGroupEdges.length} cross-group`);
console.log(`  output   : ${outDir}`);
console.log("  result   : OK");
