import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { RawDependencyGraph } from "@repohive/shared";
import { assess, DEFAULT_ASSESSMENT_CONFIG } from "./assessor.js";
import { ingest } from "./ingestor.js";
import { computeWeights } from "./weights.js";
import { arbitraryDependencyGraph } from "./test-support/arbitraries.js";

/** ingest + computeWeights, asserting the graph is valid (test scaffolding). */
function weightedModelOf(graph: RawDependencyGraph) {
  const result = ingest(graph);
  assert.ok(result.ok, "valid graph must ingest");
  return computeWeights(result.value);
}

// Feature: hierarchical-repository-grouping, Property 9: Structural_Quality_Score is always in range and finite
test("Property 9: every region score is finite and in [0, 1]; degenerate regions get the configured degenerate score (R3.6, R3.8, R3.9)", () => {
  fc.assert(
    fc.property(
      fc.record({
        graph: arbitraryDependencyGraph(),
        cohesionWeight: fc.double({ min: 0.01, max: 5, noNaN: true }),
        couplingWeight: fc.double({ min: 0.01, max: 5, noNaN: true }),
        modularityWeight: fc.double({ min: 0.01, max: 5, noNaN: true }),
        computeModularity: fc.boolean(),
        squashConstant: fc.double({ min: 0.1, max: 5, noNaN: true }),
      }),
      ({ graph, cohesionWeight, couplingWeight, modularityWeight, computeModularity, squashConstant }) => {
        const weighted = weightedModelOf(graph);
        // Weights need not sum to 1 — the assessor renormalizes the active set.
        const assessment = assess(weighted, {
          weights: { cohesion: cohesionWeight, coupling: couplingWeight, modularity: modularityWeight },
          computeModularity,
          cohesionSquashConstant: squashConstant,
          degenerateScore: 0,
        });

        assert.ok(assessment.regions.length > 0, "at least one region for a non-empty graph");
        for (const region of assessment.regions) {
          assert.ok(Number.isFinite(region.score), `score of ${region.regionId} must be finite`);
          assert.ok(region.score >= 0, `score of ${region.regionId} must be >= 0`);
          assert.ok(region.score <= 1, `score of ${region.regionId} must be <= 1`);
          if (region.degenerate) {
            // Degenerate rule: exactly the configured degenerateScore (here 0).
            assert.equal(region.score, 0);
          }
        }
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 10: Cohesion and Coupling match their reference definitions
test("Property 10: cohesion and coupling equal an independent reference computation (R3.3, R3.4)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const weighted = weightedModelOf(graph);
      const assessment = assess(weighted, DEFAULT_ASSESSMENT_CONFIG);

      // Reference owner mapping: a file owns itself; classes/functions map to
      // their defining file; unknown owners drop the edge.
      const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
      const owningFile = (id: string): string | null => {
        const node = nodeById.get(id);
        if (!node) {
          return null;
        }
        if (node.kind === "file") {
          return node.id;
        }
        return node.definedInFile !== undefined && nodeById.has(node.definedInFile) ? node.definedInFile : null;
      };

      // Reference accumulation over the weighted edges: same-file edges are
      // skipped; intra edges count once for their region, boundary-crossing
      // edges count for both endpoint regions.
      const intraStrength = new Map<string, number>();
      const crossStrength = new Map<string, number>();
      for (const edge of weighted.weightedEdges) {
        const sourceFile = owningFile(edge.source);
        const targetFile = owningFile(edge.target);
        if (sourceFile === null || targetFile === null || sourceFile === targetFile) {
          continue;
        }
        const sourceRegion = assessment.primaryRegionOf.get(sourceFile);
        const targetRegion = assessment.primaryRegionOf.get(targetFile);
        if (sourceRegion === undefined || targetRegion === undefined) {
          continue;
        }
        if (sourceRegion === targetRegion) {
          intraStrength.set(sourceRegion, (intraStrength.get(sourceRegion) ?? 0) + edge.strength);
        } else {
          crossStrength.set(sourceRegion, (crossStrength.get(sourceRegion) ?? 0) + edge.strength);
          crossStrength.set(targetRegion, (crossStrength.get(targetRegion) ?? 0) + edge.strength);
        }
      }

      // Reference file counts per region.
      const fileCount = new Map<string, number>();
      for (const regionId of assessment.primaryRegionOf.values()) {
        fileCount.set(regionId, (fileCount.get(regionId) ?? 0) + 1);
      }

      for (const region of assessment.regions) {
        const files = fileCount.get(region.regionId) ?? 0;
        const intra = intraStrength.get(region.regionId) ?? 0;
        const cross = crossStrength.get(region.regionId) ?? 0;
        const expectedCohesion = files > 0 ? intra / files : 0;
        const incident = intra + cross;
        const expectedCoupling = incident > 0 ? cross / incident : 0;
        assert.ok(
          Math.abs(region.cohesion - expectedCohesion) < 1e-9,
          `cohesion of ${region.regionId}: got ${region.cohesion}, reference ${expectedCohesion}`
        );
        assert.ok(
          Math.abs(region.coupling - expectedCoupling) < 1e-9,
          `coupling of ${region.regionId}: got ${region.coupling}, reference ${expectedCoupling}`
        );
      }
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 11: Structural-quality assessment is deterministic
test("Property 11: assessing the same weighted model twice yields identical metrics (R3.10)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const weighted = weightedModelOf(graph);
      // Default weights already include modularity; turn its computation on.
      const config = { ...DEFAULT_ASSESSMENT_CONFIG, computeModularity: true };

      const first = assess(weighted, config);
      const second = assess(weighted, config);

      assert.equal(second.regions.length, first.regions.length);
      first.regions.forEach((region, i) => {
        const rerun = second.regions[i]!;
        assert.equal(rerun.regionId, region.regionId);
        assert.equal(rerun.cohesion, region.cohesion);
        assert.equal(rerun.coupling, region.coupling);
        assert.equal(rerun.modularity, region.modularity);
        assert.equal(rerun.score, region.score);
      });
    }),
    { numRuns: 100 }
  );
});

/**
 * Two packages of two files each; strength-1 edges A1→A2 and B1→B2 inside the
 * packages and A1→B1 across them (default coefficients make each strength 1).
 */
function twoPackageGraph(): { graph: RawDependencyGraph; fileIds: string[] } {
  const a1 = "file:src/a/A1.java";
  const a2 = "file:src/a/A2.java";
  const b1 = "file:src/b/B1.java";
  const b2 = "file:src/b/B2.java";
  const signal = { importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 };
  const graph: RawDependencyGraph = {
    nodes: [
      { id: a1, kind: "file", packagePath: "a", directoryPath: "src/a" },
      { id: a2, kind: "file", packagePath: "a", directoryPath: "src/a" },
      { id: b1, kind: "file", packagePath: "b", directoryPath: "src/b" },
      { id: b2, kind: "file", packagePath: "b", directoryPath: "src/b" },
    ],
    edges: [
      { source: a1, target: a2, ...signal },
      { source: b1, target: b2, ...signal },
      { source: a1, target: b1, ...signal },
    ],
  };
  return { graph, fileIds: [a1, a2, b1, b2] };
}

test("R3.5: partition modularity equals the hand-computed Newman Q of the two-package graph", () => {
  const { graph, fileIds } = twoPackageGraph();
  const [a1, a2, b1, b2] = fileIds as [string, string, string, string];
  const weighted = weightedModelOf(graph);
  const assessment = assess(weighted, { ...DEFAULT_ASSESSMENT_CONFIG, computeModularity: true });

  // Newman Q from first principles on the undirected weighted projection:
  // Q = Σ_c [ intraWeight(c)/m − (degreeSum(c)/(2m))² ].
  const community: Record<string, string> = { [a1]: "A", [a2]: "A", [b1]: "B", [b2]: "B" };
  const undirectedEdges: Array<[string, string, number]> = [
    [a1, a2, 1],
    [b1, b2, 1],
    [a1, b1, 1],
  ];
  const m = undirectedEdges.reduce((sum, [, , w]) => sum + w, 0);
  const degree = new Map<string, number>();
  const intraWeight = new Map<string, number>();
  for (const [u, v, w] of undirectedEdges) {
    degree.set(u, (degree.get(u) ?? 0) + w);
    degree.set(v, (degree.get(v) ?? 0) + w);
    if (community[u] === community[v]) {
      intraWeight.set(community[u]!, (intraWeight.get(community[u]!) ?? 0) + w);
    }
  }
  const degreeSum = new Map<string, number>();
  for (const [node, d] of degree) {
    const c = community[node]!;
    degreeSum.set(c, (degreeSum.get(c) ?? 0) + d);
  }
  let expectedQ = 0;
  for (const c of new Set(Object.values(community))) {
    expectedQ += (intraWeight.get(c) ?? 0) / m - ((degreeSum.get(c) ?? 0) / (2 * m)) ** 2;
  }
  // Derivation sanity: m=3, each community has intra 1 and degree sum 3, so
  // Q = 2·(1/3 − (3/6)²) = 1/6.
  assert.ok(Math.abs(expectedQ - 1 / 6) < 1e-12, "hand computation must yield Q = 1/6");

  assert.equal(assessment.regions.length, 2);
  for (const region of assessment.regions) {
    assert.ok(!region.degenerate, `${region.regionId} has 2 files and 1 internal edge`);
    assert.ok(region.modularity !== undefined, `${region.regionId} must carry the partition Q`);
    assert.ok(
      Math.abs(region.modularity - expectedQ) < 1e-9,
      `modularity of ${region.regionId}: got ${region.modularity}, expected ${expectedQ}`
    );
  }
});

test("R3.7: metricWeights echoes the configured weights (modularity dropped when not computed) and the squash constant", () => {
  const weighted = weightedModelOf(twoPackageGraph().graph);
  const weights = { cohesion: 0.5, coupling: 0.3, modularity: 0.2 };

  const without = assess(weighted, {
    weights,
    computeModularity: false,
    cohesionSquashConstant: 2.5,
    degenerateScore: 0,
  });
  assert.deepEqual(without.metricWeights, { cohesion: 0.5, coupling: 0.3 });
  assert.ok(!("modularity" in without.metricWeights), "modularity weight dropped when not computed");
  assert.equal(without.cohesionSquashConstant, 2.5);

  const withModularity = assess(weighted, {
    weights,
    computeModularity: true,
    cohesionSquashConstant: 0.75,
    degenerateScore: 0,
  });
  assert.deepEqual(withModularity.metricWeights, weights);
  assert.equal(withModularity.cohesionSquashConstant, 0.75);
});

test("both degenerate arms of R3.9 get the documented neutral score, independently of the implementation's flag", () => {
  // Arm 1: an edgeless MULTI-file region (2 nodes, 0 internal edges) — the
  // arm a wrong predicate (e.g. only checking node count) would miss. The
  // region's files each have a crossing edge so metrics are otherwise nonzero.
  const graph: RawDependencyGraph = {
    nodes: [
      { id: "file:src/com/empty/E1.java", kind: "file", packagePath: "com.empty", directoryPath: "src/com/empty" },
      { id: "file:src/com/empty/E2.java", kind: "file", packagePath: "com.empty", directoryPath: "src/com/empty" },
      { id: "file:src/com/full/F1.java", kind: "file", packagePath: "com.full", directoryPath: "src/com/full" },
      { id: "file:src/com/full/F2.java", kind: "file", packagePath: "com.full", directoryPath: "src/com/full" },
      { id: "file:src/com/lone/L.java", kind: "file", packagePath: "com.lone", directoryPath: "src/com/lone" },
    ],
    edges: [
      // com.empty: no intra edges, only crossing ones.
      { source: "file:src/com/empty/E1.java", target: "file:src/com/full/F1.java", importFrequency: 3, methodCallFrequency: 0, sharedTypeCount: 0 },
      { source: "file:src/com/empty/E2.java", target: "file:src/com/full/F2.java", importFrequency: 3, methodCallFrequency: 0, sharedTypeCount: 0 },
      // com.full: a real intra edge → NOT degenerate.
      { source: "file:src/com/full/F1.java", target: "file:src/com/full/F2.java", importFrequency: 5, methodCallFrequency: 0, sharedTypeCount: 0 },
    ],
  };
  const assessment = assess(weightedModelOf(graph));
  const byId = new Map(assessment.regions.map((r) => [r.regionId, r]));

  // Edgeless two-file region → degenerate score 0.0 (default), NOT
  // combineScore(0, 0) which would be 0.5 under default weights.
  const empty = byId.get("pkg:com.empty");
  assert.ok(empty !== undefined);
  assert.equal(empty.score, 0.0);

  // Arm 2: the singleton region (<2 nodes) → same neutral score.
  const lone = byId.get("pkg:com.lone");
  assert.ok(lone !== undefined);
  assert.equal(lone.score, 0.0);

  // Control: the well-connected region is NOT degenerate and scores > 0.
  const full = byId.get("pkg:com.full");
  assert.ok(full !== undefined);
  assert.ok(full.score > 0);
});

test("modularity over an all-zero-strength projection is treated as not computed, never NaN (design 3.6 numeric safety)", () => {
  // One inter-file edge whose signals are all zero → strength 0 → the
  // weighted projection has zero total weight, where Newman Q would be NaN.
  const graph: RawDependencyGraph = {
    nodes: [
      { id: "file:src/com/z/Z1.java", kind: "file", packagePath: "com.z", directoryPath: "src/com/z" },
      { id: "file:src/com/z/Z2.java", kind: "file", packagePath: "com.z", directoryPath: "src/com/z" },
    ],
    edges: [
      { source: "file:src/com/z/Z1.java", target: "file:src/com/z/Z2.java", importFrequency: 0, methodCallFrequency: 0, sharedTypeCount: 0 },
    ],
  };
  const config = {
    weights: { cohesion: 0.4, coupling: 0.4, modularity: 0.2 },
    computeModularity: true,
    cohesionSquashConstant: 1.0,
    degenerateScore: 0.0,
  };
  const withModularity = assess(weightedModelOf(graph), config);
  const withoutModularity = assess(weightedModelOf(graph), { ...config, computeModularity: false });

  for (const region of withModularity.regions) {
    assert.equal(region.modularity, undefined, "zero-weight projection must yield no modularity value");
    assert.ok(Number.isFinite(region.score));
  }
  // With modularity dropped, the score must equal the not-computed path
  // (weights renormalized identically) — no silent worst-case bias.
  assert.deepEqual(
    withModularity.regions.map((r) => r.score),
    withoutModularity.regions.map((r) => r.score)
  );
});
