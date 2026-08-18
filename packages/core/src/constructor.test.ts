import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import type { RawDependencyGraph } from "@repohive/shared";
import { assess } from "./assessor.js";
import { LouvainCommunityDetector } from "./community.js";
import { construct, decideAction } from "./constructor.js";
import { ingest } from "./ingestor.js";
import { arbitraryDependencyGraph } from "./test-support/arbitraries.js";
import type {
  Action,
  ConstructionResult,
  RegionAssessment,
  RegionId,
  WeightedModel,
} from "./types.js";
import { computeWeights } from "./weights.js";

const arbitraryBoundary = fc.double({ min: 0, max: 1, noNaN: true });
const arbitraryAction = fc.constantFrom<Action>("preserve", "reconstruct");
/** Index/action picks resolved to concrete Region ids inside each property. */
const arbitraryOverridePicks = fc.array(
  fc.record({ pick: fc.nat(100), action: arbitraryAction }),
  { maxLength: 6 }
);

function assessGraph(graph: RawDependencyGraph): {
  weighted: WeightedModel;
  assessment: RegionAssessment;
} {
  const result = ingest(graph);
  assert.ok(result.ok, "valid graph must ingest");
  const weighted = computeWeights(result.value);
  return { weighted, assessment: assess(weighted) };
}

/** Resolve generated picks to a subset of the assessment's Region ids. */
function overridesFrom(
  assessment: RegionAssessment,
  picks: Array<{ pick: number; action: Action }>
): Map<RegionId, Action> {
  const overrides = new Map<RegionId, Action>();
  for (const { pick, action } of picks) {
    const region = assessment.regions[pick % assessment.regions.length]!;
    overrides.set(region.regionId, action);
  }
  return overrides;
}

/** Maps have no deterministic entry order guarantee for deepEqual across runs; compare as sorted arrays. */
function comparable(result: ConstructionResult): {
  decisions: ConstructionResult["decisions"];
  regionGroups: Array<[RegionId, ConstructionResult["regionGroups"] extends Map<string, infer V> ? V : never]>;
} {
  return {
    decisions: result.decisions,
    regionGroups: [...result.regionGroups.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    ),
  };
}

// Feature: hierarchical-repository-grouping, Property 12: The preserve-versus-reconstruct decision matches the boundary comparison
test("Property 12: the preserve-versus-reconstruct decision matches the boundary comparison (R4.1, R4.2, R4.3)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), arbitraryBoundary, (graph, boundary) => {
      const { weighted, assessment } = assessGraph(graph);
      const construction = construct(
        weighted,
        assessment,
        { structuralQualityBoundary: boundary, communityDetectionSeed: 42 },
        new LouvainCommunityDetector()
      );

      for (const decision of construction.decisions) {
        // Exactly one action, drawn from the two-value Action set.
        assert.ok(decision.action === "preserve" || decision.action === "reconstruct");
        // The automatic decision is exactly the boundary comparison.
        assert.equal(decision.automaticAction, decision.score >= boundary ? "preserve" : "reconstruct");
        // Without overrides the applied action IS the automatic one.
        assert.equal(decision.action, decision.automaticAction);
      }
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 13: User-supplied actions override the automatic decision
test("Property 13: user-supplied actions override the automatic decision (R4.6)", () => {
  fc.assert(
    fc.property(
      arbitraryDependencyGraph(),
      arbitraryBoundary,
      arbitraryOverridePicks,
      (graph, boundary, picks) => {
        const { weighted, assessment } = assessGraph(graph);
        const overrides = overridesFrom(assessment, picks);
        const construction = construct(
          weighted,
          assessment,
          { structuralQualityBoundary: boundary, communityDetectionSeed: 42, overrides },
          new LouvainCommunityDetector()
        );

        for (const decision of construction.decisions) {
          const override = overrides.get(decision.regionId);
          if (override !== undefined) {
            assert.equal(decision.action, override);
            assert.equal(decision.userOverridden, true);
          } else {
            assert.equal(decision.userOverridden, false);
            assert.equal(decision.action, decision.automaticAction);
          }
        }
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 14: Construction assigns every File to exactly one group result
test("Property 14: construction assigns every File to exactly one group result (R4.5)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), arbitraryBoundary, (graph, boundary) => {
      const { weighted, assessment } = assessGraph(graph);
      const construction = construct(
        weighted,
        assessment,
        { structuralQualityBoundary: boundary, communityDetectionSeed: 42 },
        new LouvainCommunityDetector()
      );

      const grouped: string[] = [];
      for (const groups of construction.regionGroups.values()) {
        for (const group of groups) {
          grouped.push(...group.fileIds);
        }
      }
      const expected = weighted.nodes.filter((n) => n.kind === "file").map((n) => n.id);
      // Sorted-array deep equality = multiset equality: every File id exactly once.
      assert.deepEqual([...grouped].sort(), [...expected].sort());
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 15: Construction is deterministic given an identical boundary
test("Property 15: construction is deterministic given an identical boundary (R4.7)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), arbitraryBoundary, (graph, boundary) => {
      const { weighted, assessment } = assessGraph(graph);
      const config = { structuralQualityBoundary: boundary, communityDetectionSeed: 42 };
      const first = construct(weighted, assessment, config, new LouvainCommunityDetector());
      const second = construct(weighted, assessment, config, new LouvainCommunityDetector());

      assert.deepEqual(comparable(second), comparable(first));
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 16: Per-Region metadata is complete and consistent
test("Property 16: per-Region metadata is complete and consistent (R5.1, R5.3, R5.4)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), arbitraryBoundary, (graph, boundary) => {
      const { weighted, assessment } = assessGraph(graph);
      const construction = construct(
        weighted,
        assessment,
        { structuralQualityBoundary: boundary, communityDetectionSeed: 42 },
        new LouvainCommunityDetector()
      );

      // Exactly one decision per Region in the assessment.
      assert.equal(construction.decisions.length, assessment.regions.length);
      assert.deepEqual(
        new Set(construction.decisions.map((d) => d.regionId)),
        new Set(assessment.regions.map((r) => r.regionId))
      );
      assert.equal(new Set(construction.decisions.map((d) => d.regionId)).size, construction.decisions.length);

      for (const decision of construction.decisions) {
        assert.equal(typeof decision.regionId, "string");
        assert.ok(decision.regionId.length > 0);
        assert.ok(Number.isFinite(decision.cohesion));
        assert.ok(Number.isFinite(decision.coupling));
        assert.ok(Number.isFinite(decision.score));
        assert.ok(decision.action === "preserve" || decision.action === "reconstruct");
        assert.ok(
          Math.abs(decision.decisionConfidence - Math.abs(decision.score - boundary)) <= 1e-12,
          "decisionConfidence must be |score − boundary|"
        );
      }
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 17: Overridden decisions record both the user and automatic action
test("Property 17: overridden decisions record both the user and automatic action (R5.6)", () => {
  fc.assert(
    fc.property(
      arbitraryDependencyGraph(),
      arbitraryBoundary,
      arbitraryOverridePicks,
      (graph, boundary, picks) => {
        const { weighted, assessment } = assessGraph(graph);
        const overrides = overridesFrom(assessment, picks);
        const construction = construct(
          weighted,
          assessment,
          { structuralQualityBoundary: boundary, communityDetectionSeed: 42, overrides },
          new LouvainCommunityDetector()
        );

        for (const decision of construction.decisions) {
          // The automatic action survives overriding, and matches the pure comparison.
          assert.equal(decision.automaticAction, decideAction(decision.score, boundary));
          assert.equal(decision.userOverridden, overrides.has(decision.regionId));
          if (overrides.has(decision.regionId)) {
            assert.equal(decision.action, overrides.get(decision.regionId));
          }
        }
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 18: Recorded boundary and scores reproduce the original decisions
test("Property 18: recorded boundary and scores reproduce the original decisions (R5.7)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), arbitraryBoundary, (graph, boundary) => {
      const { weighted, assessment } = assessGraph(graph);
      const construction = construct(
        weighted,
        assessment,
        { structuralQualityBoundary: boundary, communityDetectionSeed: 42 },
        new LouvainCommunityDetector()
      );

      // Req 5.7 is about the RECORDED values: push the decisions and the
      // boundary through a JSON round-trip (what metadata.json does) and
      // replay the comparison over the parsed values — this catches any
      // serialization precision loss that could flip a near-boundary
      // decision, which an in-memory replay never would.
      const recorded = JSON.parse(
        JSON.stringify({ boundary, decisions: construction.decisions })
      ) as { boundary: number; decisions: typeof construction.decisions };
      assert.equal(recorded.decisions.length, construction.decisions.length);
      for (let i = 0; i < recorded.decisions.length; i++) {
        const replayed = decideAction(recorded.decisions[i]!.score, recorded.boundary);
        assert.equal(replayed, construction.decisions[i]!.automaticAction);
        assert.equal(recorded.decisions[i]!.regionId, construction.decisions[i]!.regionId);
      }
    }),
    { numRuns: 100 }
  );
});

test("boundary 0 preserves everywhere and boundary 1.000001 reconstructs everywhere on the same assessed graph (R4.4)", () => {
  const graph: RawDependencyGraph = {
    nodes: [
      { id: "file:src/com/alpha/A.java", kind: "file", packagePath: "com.alpha", directoryPath: "src/com/alpha" },
      { id: "file:src/com/alpha/B.java", kind: "file", packagePath: "com.alpha", directoryPath: "src/com/alpha" },
      { id: "file:src/com/beta/C.java", kind: "file", packagePath: "com.beta", directoryPath: "src/com/beta" },
      { id: "file:src/com/beta/D.java", kind: "file", packagePath: "com.beta", directoryPath: "src/com/beta" },
    ],
    edges: [
      {
        source: "file:src/com/alpha/A.java",
        target: "file:src/com/alpha/B.java",
        importFrequency: 3,
        methodCallFrequency: 2,
        sharedTypeCount: 1,
      },
      {
        source: "file:src/com/beta/C.java",
        target: "file:src/com/beta/D.java",
        importFrequency: 1,
        methodCallFrequency: 0,
        sharedTypeCount: 0,
      },
      {
        source: "file:src/com/alpha/B.java",
        target: "file:src/com/beta/C.java",
        importFrequency: 1,
        methodCallFrequency: 1,
        sharedTypeCount: 0,
      },
    ],
  };
  const { weighted, assessment } = assessGraph(graph);

  // Scores live in [0, 1]: boundary 0 makes score ≥ boundary universally true...
  const preserved = construct(
    weighted,
    assessment,
    { structuralQualityBoundary: 0, communityDetectionSeed: 42 },
    new LouvainCommunityDetector()
  );
  assert.ok(preserved.decisions.length > 0);
  for (const decision of preserved.decisions) {
    assert.equal(decision.action, "preserve");
  }
  // ...and a preserved Region keeps its Files together as one group.
  for (const region of assessment.regions) {
    const groups = preserved.regionGroups.get(region.regionId);
    assert.ok(groups && groups.length === 1);
    assert.deepEqual([...groups[0]!.fileIds].sort(), [...region.nodeIds].sort());
  }

  // ...while a boundary just above 1 makes it universally false. Pure
  // configuration flips every decision — no code change.
  const reconstructed = construct(
    weighted,
    assessment,
    { structuralQualityBoundary: 1.000001, communityDetectionSeed: 42 },
    new LouvainCommunityDetector()
  );
  assert.equal(reconstructed.decisions.length, preserved.decisions.length);
  for (const decision of reconstructed.decisions) {
    assert.equal(decision.action, "reconstruct");
  }
});

test("decisions carry the Modularity value WHERE it is computed (R5.1)", () => {
  const graph: RawDependencyGraph = {
    nodes: [
      { id: "file:src/com/alpha/A.java", kind: "file", packagePath: "com.alpha", directoryPath: "src/com/alpha" },
      { id: "file:src/com/alpha/B.java", kind: "file", packagePath: "com.alpha", directoryPath: "src/com/alpha" },
      { id: "file:src/com/beta/C.java", kind: "file", packagePath: "com.beta", directoryPath: "src/com/beta" },
      { id: "file:src/com/beta/D.java", kind: "file", packagePath: "com.beta", directoryPath: "src/com/beta" },
    ],
    edges: [
      { source: "file:src/com/alpha/A.java", target: "file:src/com/alpha/B.java", importFrequency: 2, methodCallFrequency: 0, sharedTypeCount: 0 },
      { source: "file:src/com/beta/C.java", target: "file:src/com/beta/D.java", importFrequency: 2, methodCallFrequency: 0, sharedTypeCount: 0 },
      { source: "file:src/com/alpha/A.java", target: "file:src/com/beta/C.java", importFrequency: 1, methodCallFrequency: 0, sharedTypeCount: 0 },
    ],
  };
  const ingested = ingest(graph);
  assert.ok(ingested.ok);
  const weighted = computeWeights(ingested.value);

  // Modularity ON → every decision records a finite modularity value.
  const withModularity = construct(
    weighted,
    assess(weighted, {
      weights: { cohesion: 0.4, coupling: 0.4, modularity: 0.2 },
      computeModularity: true,
      cohesionSquashConstant: 1.0,
      degenerateScore: 0.0,
    }),
    { structuralQualityBoundary: 0.5, communityDetectionSeed: 42 },
    new LouvainCommunityDetector()
  );
  for (const decision of withModularity.decisions) {
    assert.ok(decision.modularity !== undefined, "modularity must be recorded where computed");
    assert.ok(Number.isFinite(decision.modularity));
  }

  // Modularity OFF (default) → the field is absent, not zero/null.
  const withoutModularity = construct(
    weighted,
    assess(weighted),
    { structuralQualityBoundary: 0.5, communityDetectionSeed: 42 },
    new LouvainCommunityDetector()
  );
  for (const decision of withoutModularity.decisions) {
    assert.ok(!("modularity" in decision), "modularity must be omitted where not computed");
  }

  // The recorded value survives a JSON round-trip (metadata.json path).
  const recorded = JSON.parse(JSON.stringify(withModularity.decisions)) as typeof withModularity.decisions;
  for (let i = 0; i < recorded.length; i++) {
    assert.equal(recorded[i]!.modularity, withModularity.decisions[i]!.modularity);
  }
});
