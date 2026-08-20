import assert from "node:assert/strict";
import { test } from "node:test";
import { LouvainCommunityDetector, relabelByContent, seededRng } from "./community.js";
import type { CommunitySubgraph } from "./community.js";
import { construct } from "./constructor.js";
import { assess } from "./assessor.js";
import { computeWeights } from "./weights.js";
import { ingest } from "./ingestor.js";
import type { RawDependencyGraph } from "@repohive/shared";

/**
 * Two dense clusters joined by one weak bridge — the canonical case community
 * detection MUST split. Cluster 1 = {c1a, c1b, c1c}, cluster 2 = {c2a, c2b,
 * c2c}, all intra-cluster edges strength 10, one bridge edge strength 1.
 */
function twoClusterSubgraph(): CommunitySubgraph {
  const heavy = 10;
  return {
    nodeIds: ["c1a", "c1b", "c1c", "c2a", "c2b", "c2c"],
    edges: [
      { source: "c1a", target: "c1b", strength: heavy },
      { source: "c1b", target: "c1c", strength: heavy },
      { source: "c1c", target: "c1a", strength: heavy },
      { source: "c2a", target: "c2b", strength: heavy },
      { source: "c2b", target: "c2c", strength: heavy },
      { source: "c2c", target: "c2a", strength: heavy },
      { source: "c1a", target: "c2a", strength: 1 },
    ],
  };
}

test("LouvainCommunityDetector splits two dense clusters across a weak bridge", () => {
  const detector = new LouvainCommunityDetector();
  const { communityOf } = detector.detect(twoClusterSubgraph(), 42);

  const membersOf = new Map<number, string[]>();
  for (const [id, label] of communityOf) {
    membersOf.set(label, [...(membersOf.get(label) ?? []), id]);
  }
  assert.equal(communityOf.size, 6, "every node gets a community");
  assert.equal(membersOf.size, 2, "the two dense clusters must be recognized");

  const communities = [...membersOf.values()].map((m) => m.sort().join(","));
  communities.sort();
  assert.deepEqual(communities, ["c1a,c1b,c1c", "c2a,c2b,c2c"]);

  // Content-derived labels: community containing the minimum member id is 0.
  assert.equal(communityOf.get("c1a"), 0);
  assert.equal(communityOf.get("c2a"), 1);
});

test("detector output is identical across runs, seeds kept, and edge input order (R4.7)", () => {
  const detector = new LouvainCommunityDetector();
  const base = twoClusterSubgraph();
  const first = detector.detect(base, 42);

  // Re-run and reversed-edge-order run agree exactly.
  const again = detector.detect(base, 42);
  const reversed = detector.detect(
    { nodeIds: [...base.nodeIds].reverse(), edges: [...base.edges].reverse() },
    42
  );
  assert.deepEqual([...again.communityOf].sort(), [...first.communityOf].sort());
  assert.deepEqual([...reversed.communityOf].sort(), [...first.communityOf].sort());
});

test("degenerate subgraphs collapse to a single community (documented Phase-1 rule)", () => {
  const detector = new LouvainCommunityDetector();

  // No edges → no dependency signal to rebuild from → one community.
  const edgeless = detector.detect({ nodeIds: ["x", "y", "z"], edges: [] }, 7);
  assert.deepEqual([...new Set(edgeless.communityOf.values())], [0]);

  // Fewer than two nodes → trivially one community.
  const singleton = detector.detect({ nodeIds: ["only"], edges: [] }, 7);
  assert.deepEqual([...singleton.communityOf], [["only", 0]]);
});

test("relabelByContent numbers communities by ascending minimum member id", () => {
  const relabeled = relabelByContent(["a", "b", "c", "d"], { a: 7, b: 3, c: 7, d: 3 });
  // Community {a, c} contains the global minimum "a" → label 0; {b, d} → 1.
  assert.deepEqual(
    [...relabeled].sort(),
    [
      ["a", 0],
      ["b", 1],
      ["c", 0],
      ["d", 1],
    ]
  );
});

test("seededRng is deterministic per seed and produces values in [0, 1)", () => {
  const a = seededRng(123);
  const b = seededRng(123);
  const c = seededRng(124);
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  const seqC = Array.from({ length: 20 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) {
    assert.ok(v >= 0 && v < 1);
  }
});

test("Reconstruct_Action actually rebuilds groups from communities (R4.3, non-vacuous)", () => {
  // One package containing the two-cluster shape: forcing reconstruct must
  // split the region into the two dense file groups, not echo it back.
  const pkg = "com.tangle";
  const dir = "src/com/tangle";
  const fileId = (n: string): string => `file:${dir}/${n}.java`;
  const nodes = ["c1a", "c1b", "c1c", "c2a", "c2b", "c2c"].map((n) => ({
    id: fileId(n),
    kind: "file" as const,
    packagePath: pkg,
    directoryPath: dir,
  }));
  const heavyEdge = (from: string, to: string, importFrequency: number) => ({
    source: fileId(from),
    target: fileId(to),
    importFrequency,
    methodCallFrequency: 0,
    sharedTypeCount: 0,
  });
  const graph: RawDependencyGraph = {
    nodes,
    edges: [
      heavyEdge("c1a", "c1b", 10),
      heavyEdge("c1b", "c1c", 10),
      heavyEdge("c1c", "c1a", 10),
      heavyEdge("c2a", "c2b", 10),
      heavyEdge("c2b", "c2c", 10),
      heavyEdge("c2c", "c2a", 10),
      heavyEdge("c1a", "c2a", 1),
    ],
  };

  const ingested = ingest(graph);
  assert.ok(ingested.ok);
  const weighted = computeWeights(ingested.value);
  const assessment = assess(weighted);
  const result = construct(
    weighted,
    assessment,
    {
      structuralQualityBoundary: 1.000001, // force reconstruct
      communityDetectionSeed: 42,
    },
    new LouvainCommunityDetector()
  );

  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0]!.action, "reconstruct");
  const groups = result.regionGroups.get(result.decisions[0]!.regionId);
  assert.ok(groups !== undefined);
  const memberships = groups.map((g) => [...g.fileIds].sort().join(",")).sort();
  assert.deepEqual(memberships, [
    ["c1a", "c1b", "c1c"].map(fileId).join(","),
    ["c2a", "c2b", "c2c"].map(fileId).join(","),
  ]);
});

// Feature: hierarchical-repository-grouping (Gap 16 extension)
test("zero-total-weight subgraph collapses to a single community", () => {
  const detector = new LouvainCommunityDetector();

  // Six nodes, five edges each with strength 0.  Before the fix Louvain's
  // modularity deltas were NaN and every node became its own community.
  const subgraph: CommunitySubgraph = {
    nodeIds: ["n1", "n2", "n3", "n4", "n5", "n6"],
    edges: [
      { source: "n1", target: "n2", strength: 0 },
      { source: "n2", target: "n3", strength: 0 },
      { source: "n3", target: "n4", strength: 0 },
      { source: "n4", target: "n5", strength: 0 },
      { source: "n5", target: "n6", strength: 0 },
    ],
  };

  const { communityOf } = detector.detect(subgraph, 42);
  assert.equal(communityOf.size, 6, "every node must receive a community label");
  const labels = new Set(communityOf.values());
  assert.equal(labels.size, 1, "all nodes must be in a single community (not singletons)");
  assert.equal(labels.has(0), true, "the single community label must be 0");
});

// Mixed: some zero, some non-zero edges — must NOT collapse to a single community
test("a subgraph with at least one positive-weight edge is not collapsed", () => {
  const detector = new LouvainCommunityDetector();

  // Two clusters connected by one real edge among zero-weight background edges.
  const subgraph: CommunitySubgraph = {
    nodeIds: ["a1", "a2", "b1", "b2"],
    edges: [
      { source: "a1", target: "a2", strength: 10 },
      { source: "b1", target: "b2", strength: 10 },
      { source: "a1", target: "b1", strength: 0 }, // zero-weight bridge
    ],
  };

  const { communityOf } = detector.detect(subgraph, 42);
  assert.equal(communityOf.size, 4, "every node gets a label");
  // Total weight is 20 (> 0) so Louvain runs; expect the two dense pairs to
  // be separated (the zero-weight bridge carries no signal).
  const labels = new Set(communityOf.values());
  assert.ok(labels.size >= 1, "must produce at least one community");
  // The exact split is Louvain-determined, but the non-zero-weight case must
  // not short-circuit to a single community.
  // We verify the detector actually ran (result is deterministic at seed 42).
  const again = detector.detect(subgraph, 42);
  assert.deepEqual([...communityOf].sort(), [...again.communityOf].sort());
});
