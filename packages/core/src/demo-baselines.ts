/**
 * Evaluation aid: run the three construction policies from the
 * design's Evaluation Design over the same graph - always-preserve,
 * always-reconstruct, and adaptive - purely through configuration (boundary
 * placement), and print the per-Region decisions plus the navigation-oriented
 * metadata statistics side by side. No special code path exists for the
 * baselines, so differences are attributable to the adaptive policy alone.
 *
 * usage: npm run demo:baselines [-- <graph.json | dir>]
 */

import { statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { describeError } from "./errors.js";
import { groupGraph, readGraphFile, type PartialGroupingConfig } from "./orchestrator.js";
import type { Metadata } from "./types.js";

function resolveAgainstInvocationDir(path: string): string {
  if (isAbsolute(path)) {
    return path;
  }
  return resolve(process.env.INIT_CWD ?? process.cwd(), path);
}

const inputArg = process.argv[2] ?? "fixtures/sample-java-project";
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

// Baselines are reachable purely through boundary placement: scores live in
// [0, 1], so boundary 0 preserves everything and boundary >1 reconstructs
// everything (score >= boundary → preserve).
const POLICIES: Array<{ name: string; config: PartialGroupingConfig }> = [
  { name: "always-preserve", config: { structuralQualityBoundary: 0 } },
  { name: "always-reconstruct", config: { structuralQualityBoundary: 1.000001 } },
  { name: "adaptive", config: {} },
];

function navigationStats(metadata: Metadata): string {
  const preserved = metadata.regionDecisions.filter((d) => d.action === "preserve").length;
  const reconstructed = metadata.regionDecisions.length - preserved;
  return [
    `decisions preserve/reconstruct: ${preserved}/${reconstructed}`,
    `hierarchy depth: ${metadata.hierarchyDepth}`,
    `avg branching factor: ${metadata.averageBranchingFactor.toFixed(2)}`,
    `cross-group edges: ${metadata.totalCrossGroupEdges}`,
    `nodes per level: ${metadata.perLevel.map((l) => `L${l.level}=${l.groupNodeCount + l.leafNodeCount}`).join(" ")}`,
  ].join("\n    ");
}

console.log("RepoHIVE core - construction-policy comparison (Evaluation Design)");
console.log(`  input: ${graphPath}`);
for (const policy of POLICIES) {
  const result = groupGraph(graph.value, policy.config);
  if (!result.ok) {
    console.error(`  ${policy.name}: ${describeError(result.error)}`);
    process.exit(1);
  }
  const { metadata } = result.value;
  console.log(`\n  policy: ${policy.name} (boundary ${metadata.structuralQualityBoundary})`);
  console.log(`    ${navigationStats(metadata)}`);
  if (policy.name === "adaptive") {
    console.log("    per-region decisions:");
    for (const decision of metadata.regionDecisions) {
      console.log(
        `      ${decision.action.padEnd(11)} score=${decision.score.toFixed(3)} ` +
          `confidence=${decision.decisionConfidence.toFixed(3)} ` +
          `cohesion=${decision.cohesion.toFixed(3)} coupling=${decision.coupling.toFixed(3)} ` +
          `${decision.regionId}`
      );
    }
  }
}
