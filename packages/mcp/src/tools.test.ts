/**
 * Tool handlers over the REAL fixture index (fixtures/sample-java-project,
 * parsed and grouped by this branch's engine via make-fixture.ts). No MCP
 * client involved: handlers are pure functions over the loaded view.
 *
 * Assertions favour contract invariants (sums, canonical order, join
 * integrity, honesty framing) over exact engine values, so the suite survives
 * engine-side recalibration; the handful of exact facts asserted (five Java
 * files, known node ids) are stable properties of the checked-in fixture.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { compareIds, parseIndex } from "@repohive/core";
import { FIXTURE_INDEX_DIR } from "./make-fixture.js";
import { createIndexStore } from "./store.js";
import { buildIndexView, isAssessed, type IndexView } from "./view.js";
import {
  blastRadius,
  findNode,
  hierarchyAtLevel,
  LIMITS,
  nodeDetails,
  regionDecisions,
  repositoryOverview,
} from "./tools.js";

if (!existsSync(join(FIXTURE_INDEX_DIR, "metadata.json"))) {
  throw new Error(
    `fixture index missing at ${FIXTURE_INDEX_DIR} - run \`npm run fixture --workspace @repohive/mcp\` (pretest does this automatically)`,
  );
}

const loaded = createIndexStore(FIXTURE_INDEX_DIR).load();
if (!loaded.ok) throw new Error(`fixture index failed to load: ${loaded.message}`);
const view: IndexView = loaded.view;

function expectOk<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  assert.equal(result.ok, true, result.ok ? undefined : result.message);
  return (result as { ok: true; value: T }).value;
}

function expectFail<T>(result: { ok: true; value: T } | { ok: false; message: string }): string {
  assert.equal(result.ok, false, "expected a failure");
  return (result as { ok: false; message: string }).message;
}

function assertAscending(ids: readonly string[], label: string): void {
  for (let i = 1; i < ids.length; i++) {
    assert.ok(compareIds(ids[i - 1]!, ids[i]!) < 0, `${label} not strictly ascending at ${ids[i]}`);
  }
}

// ---------------------------------------------------------------------------
// repository_overview
// ---------------------------------------------------------------------------

test("repository_overview reports counts that cross-check against the hierarchy", () => {
  const overview = expectOk(repositoryOverview(view));
  assert.ok(overview.repositoryId.startsWith("r_"));
  assert.equal(overview.nodeKindCounts.repository, 1);
  assert.equal(overview.nodeKindCounts.file, 5, "the fixture has five Java files");

  const kindSum = Object.values(overview.nodeKindCounts).reduce((a, b) => a + b, 0);
  assert.equal(kindSum, overview.nodeCount);
  assert.equal(overview.edgeCount, overview.leafEdgeCount + overview.crossGroupEdgeCount);
  assert.equal(overview.perLevel.length, overview.hierarchyDepth + 1);

  // perLevel node counts agree with the assembled hierarchy (the engine
  // counts the level-0 repository node in the group bucket).
  for (const level of overview.perLevel) {
    const idsAtLevel = view.idsByLevel[level.level] ?? [];
    assert.equal(level.groupNodeCount + level.leafNodeCount, idsAtLevel.length);
  }
});

test("repository_overview frames the decision split assessed-only", () => {
  const overview = expectOk(repositoryOverview(view));
  const summary = overview.regionDecisions;
  assert.equal(summary.assessedRegions + summary.unassessedRegions, summary.totalRegions);
  assert.equal(summary.assessed.preserve + summary.assessed.reconstruct, summary.assessedRegions);
  assert.ok(summary.note.length > 0, "the honesty note is always present");
  if (summary.unassessedRegions > 0) {
    assert.match(summary.note, /never assessed/);
    assert.match(summary.note, /score === 0 && cohesion === 0/);
  }
  // Configuration is emitted by this branch's engine; verbatim, not invented.
  assert.notEqual(overview.configuration, null);
});

// ---------------------------------------------------------------------------
// hierarchy_at_level
// ---------------------------------------------------------------------------

test("hierarchy_at_level 0 is exactly the repository node", () => {
  const level0 = expectOk(hierarchyAtLevel(view, { level: 0 }));
  assert.equal(level0.totalAtLevel, 1);
  assert.equal(level0.nodes.length, 1);
  const root = level0.nodes[0]!;
  assert.equal(root.kind, "repository");
  assert.equal(root.parentId, null);
  assert.equal(root.descendantFileCount, 5);
  assert.equal(root.decision, null);
});

test("hierarchy_at_level joins group decisions through regionId and flags assessment", () => {
  const level1 = expectOk(hierarchyAtLevel(view, { level: 1 }));
  assert.ok(level1.nodes.length > 0);
  assertAscending(
    level1.nodes.map((n) => n.id),
    "level 1 nodes",
  );
  for (const node of level1.nodes) {
    if (node.kind !== "group") continue;
    if (node.region === null) {
      assert.equal(node.decision, null, "a group without provenance joins to no decision");
      continue;
    }
    const recorded = view.decisionsByRegion.get(node.region.regionId);
    assert.notEqual(recorded, undefined, `decision recorded for ${node.region.regionId}`);
    assert.notEqual(node.decision, null);
    assert.equal(node.decision!.action, recorded!.action, "action is read, not derived");
    assert.equal(node.decision!.assessed, isAssessed(recorded!));
  }
});

test("hierarchy_at_level pages deterministically over the canonical order", () => {
  const full = expectOk(hierarchyAtLevel(view, { level: 1 }));
  const pageA = expectOk(hierarchyAtLevel(view, { level: 1, limit: 2 }));
  assert.equal(pageA.returned, Math.min(2, full.totalAtLevel));
  assert.equal(pageA.truncated, full.totalAtLevel > 2);
  const pageB = expectOk(hierarchyAtLevel(view, { level: 1, offset: 2, limit: 2 }));
  const stitched = [...pageA.nodes, ...pageB.nodes].map((n) => n.id);
  assert.deepEqual(stitched, full.nodes.slice(0, 4).map((n) => n.id));
});

test("hierarchy_at_level rejects an out-of-range level, naming the valid range", () => {
  const message = expectFail(hierarchyAtLevel(view, { level: view.hierarchy.depth + 1 }));
  assert.match(message, /out of range/);
  assert.ok(message.includes(String(view.hierarchy.depth)));
  const badLimit = expectFail(hierarchyAtLevel(view, { level: 1, limit: 0 }));
  assert.match(badLimit, /limit must be an integer/);
  const badOffset = expectFail(hierarchyAtLevel(view, { level: 1, offset: -1 }));
  assert.match(badOffset, /offset must be a non-negative integer/);
});

// ---------------------------------------------------------------------------
// find_node
// ---------------------------------------------------------------------------

test("find_node bridges names to ids, ranking exact id matches first", () => {
  const byName = expectOk(findNode(view, { query: "Bootstrap" }));
  assert.ok(byName.totalMatches >= 2, "class, file and function nodes all match");
  assert.ok(byName.matches.some((m) => m.id === "file:Bootstrap.java"));

  const exact = expectOk(findNode(view, { query: "file:Bootstrap.java" }));
  assert.equal(exact.matches[0]!.id, "file:Bootstrap.java");
  assert.equal(exact.matches[0]!.matchedOn, "id");

  // Case-insensitive.
  const lower = expectOk(findNode(view, { query: "bootstrap" }));
  assert.equal(lower.totalMatches, byName.totalMatches);
});

test("find_node honours kind filter, limit and reports truncation", () => {
  const filesOnly = expectOk(findNode(view, { query: "example", kind: "file" }));
  assert.ok(filesOnly.matches.length > 0);
  for (const match of filesOnly.matches) assert.equal(match.kind, "file");

  const capped = expectOk(findNode(view, { query: "example", limit: 1 }));
  assert.equal(capped.returned, 1);
  assert.equal(capped.truncated, true);
  assert.ok(capped.totalMatches > 1);

  const none = expectOk(findNode(view, { query: "zz-no-such-entity-zz" }));
  assert.equal(none.totalMatches, 0);
  assert.deepEqual(none.matches, []);

  const empty = expectFail(findNode(view, { query: "   " }));
  assert.match(empty, /non-empty/);
});

test("find_node matches groups through their region id", () => {
  const groups = expectOk(findNode(view, { query: "pkg:com.example.model", kind: "group" }));
  assert.ok(groups.totalMatches >= 1);
  for (const match of groups.matches) {
    assert.equal(match.kind, "group");
    assert.notEqual(match.region, null);
  }
});

// ---------------------------------------------------------------------------
// node_details
// ---------------------------------------------------------------------------

test("node_details reads a file node: ancestry, children, one-hop edges", () => {
  const details = expectOk(nodeDetails(view, { nodeId: "file:Bootstrap.java" }));
  assert.equal(details.kind, "file");
  assert.equal(details.name, "Bootstrap.java");
  assert.equal(details.packagePath, "com.example");
  assert.equal(details.directoryPath, "");

  // Root-first ancestor chain with strictly ascending levels.
  assert.ok(details.ancestors.length >= 1);
  assert.equal(details.ancestors[0]!.kind, "repository");
  for (let i = 1; i < details.ancestors.length; i++) {
    assert.equal(details.ancestors[i]!.level, details.ancestors[i - 1]!.level + 1);
  }

  assert.equal(details.childCount, details.children.length);
  assert.equal(details.childrenTruncated, false);

  // Leaf kinds carry leaf edges; the group channels are explicit nulls.
  assert.notEqual(details.dependencies, null);
  assert.notEqual(details.dependents, null);
  assert.equal(details.groupDependencies, null);
  assert.equal(details.groupDependents, null);
  assert.equal(details.dependencies!.total, details.dependencies!.edges.length);
  assertAscending(
    details.dependencies!.edges.map((e) => e.target),
    "dependency targets",
  );
});

test("node_details reads a group node: full decision record, cross-group edges", () => {
  const level1 = expectOk(hierarchyAtLevel(view, { level: 1 }));
  const group = level1.nodes.find((n) => n.kind === "group" && n.region !== null);
  assert.notEqual(group, undefined, "fixture has at least one regioned group");
  const details = expectOk(nodeDetails(view, { nodeId: group!.id }));

  assert.equal(details.kind, "group");
  assert.notEqual(details.region, null);
  assert.notEqual(details.decision, null);
  assert.equal(details.decision!.regionId, details.region!.regionId);
  assert.equal(details.decision!.assessed, isAssessed(details.decision!));
  if (details.decision!.groupIds !== null) {
    assert.ok(details.decision!.groupIds.includes(group!.id), "decision names the group it produced");
    assertAscending(details.decision!.groupIds, "decision groupIds");
  }

  // Group kinds carry cross-group channels; leaf channels are explicit nulls.
  assert.equal(details.dependencies, null);
  assert.equal(details.dependents, null);
  assert.notEqual(details.groupDependencies, null);
  assert.notEqual(details.groupDependents, null);

  // packagePrefix is present (possibly "") on groups, null elsewhere.
  assert.notEqual(details.packagePrefix, null);
});

test("node_details fails usefully on unknown and empty ids", () => {
  const unknown = expectFail(nodeDetails(view, { nodeId: "file:does/not/Exist.java" }));
  assert.match(unknown, /node not found/);
  assert.match(unknown, /find_node/);
  const empty = expectFail(nodeDetails(view, { nodeId: "  " }));
  assert.match(empty, /non-empty/);
  const badLimit = expectFail(nodeDetails(view, { nodeId: "file:Bootstrap.java", edgeLimit: 0 }));
  assert.match(badLimit, /edgeLimit/);
});

// ---------------------------------------------------------------------------
// blast_radius
// ---------------------------------------------------------------------------

test("blast_radius returns the impacted set with containing groups", () => {
  // Bootstrap.java depends on UserService, so UserService's blast radius
  // includes Bootstrap.java.
  const result = expectOk(blastRadius(view, { nodeId: "class:src|com.example.service.UserService" }));
  assert.ok(result.impactedNodes.includes("class:src|com.example.service.UserService"));
  assert.ok(result.impactedNodes.includes("file:Bootstrap.java"), "reverse reachability reaches the dependent");
  assert.equal(result.truncated, false);
  assert.equal(result.impactedNodeCount, result.impactedNodes.length);
  assertAscending(result.impactedNodes, "impacted nodes");

  const kindSum = Object.values(result.kindBreakdown).reduce((a, b) => a + b, 0);
  assert.equal(kindSum, result.impactedNodeCount);

  assert.equal(result.containingGroupCount, result.containingGroups.length);
  for (const group of result.containingGroups) {
    assert.equal(view.hierarchy.nodes.get(group.id)?.kind, "group");
  }
});

test("blast_radius truncates deterministically and fails usefully", () => {
  const full = expectOk(blastRadius(view, { nodeId: "class:src|com.example.service.UserService" }));
  if (full.impactedNodeCount > 1) {
    const capped = expectOk(
      blastRadius(view, { nodeId: "class:src|com.example.service.UserService", limit: 1 }),
    );
    assert.equal(capped.impactedNodes.length, 1);
    assert.equal(capped.truncated, true);
    assert.equal(capped.impactedNodeCount, full.impactedNodeCount);
    assert.deepEqual(capped.impactedNodes, full.impactedNodes.slice(0, 1));
  }

  const unknown = expectFail(blastRadius(view, { nodeId: "file:missing/Nope.java" }));
  assert.match(unknown, /node not found/);
  assert.match(unknown, /find_node/);
});

// ---------------------------------------------------------------------------
// region_decisions
// ---------------------------------------------------------------------------

test("region_decisions lists every recorded decision canonically with the assessed flag", () => {
  const result = expectOk(regionDecisions(view, {}));
  assert.equal(result.totalMatching, view.metadata.regionDecisions.length);
  assert.equal(result.returned, result.regions.length);
  assertAscending(
    result.regions.map((r) => r.regionId),
    "region ids",
  );
  for (const region of result.regions) {
    const recorded = view.decisionsByRegion.get(region.regionId)!;
    assert.equal(region.score, recorded.score, "score is read verbatim");
    assert.equal(region.decisionConfidence, recorded.decisionConfidence);
    assert.equal(region.assessed, !(recorded.score === 0 && recorded.cohesion === 0));
    if (region.groupIds !== null) {
      for (const groupId of region.groupIds) {
        assert.equal(view.hierarchy.nodes.get(groupId)?.regionId, region.regionId, "exact Gap 12 join");
      }
    }
  }
  const summary = result.summary;
  assert.equal(summary.assessed.preserve + summary.assessed.reconstruct, summary.assessedRegions);
  assert.equal(summary.assessedRegions + summary.unassessedRegions, summary.totalRegions);
});

test("region_decisions filters by assessed and action without breaking the frame", () => {
  const all = expectOk(regionDecisions(view, {}));
  const assessedOnly = expectOk(regionDecisions(view, { assessed: true }));
  const unassessedOnly = expectOk(regionDecisions(view, { assessed: false }));
  assert.equal(assessedOnly.totalMatching + unassessedOnly.totalMatching, all.totalMatching);
  for (const region of assessedOnly.regions) assert.equal(region.assessed, true);
  for (const region of unassessedOnly.regions) assert.equal(region.assessed, false);
  // The summary is over ALL decisions regardless of filters.
  assert.deepEqual(assessedOnly.summary, all.summary);

  const reconstructed = expectOk(regionDecisions(view, { action: "reconstruct" }));
  for (const region of reconstructed.regions) assert.equal(region.action, "reconstruct");
});

test("region_decisions joins one group to its producing decision", () => {
  const level1 = expectOk(hierarchyAtLevel(view, { level: 1 }));
  const group = level1.nodes.find((n) => n.kind === "group" && n.region !== null)!;
  const result = expectOk(regionDecisions(view, { groupId: group.id }));
  assert.equal(result.totalMatching, 1);
  assert.equal(result.regions[0]!.regionId, group.region!.regionId);

  const notGroup = expectFail(regionDecisions(view, { groupId: "file:Bootstrap.java" }));
  assert.match(notGroup, /not a group/);

  const unknownGroup = expectFail(regionDecisions(view, { groupId: "g_0000000000" }));
  assert.match(unknownGroup, /node not found/);

  const unknownRegion = expectFail(regionDecisions(view, { regionId: "pkg:no.such.region" }));
  assert.match(unknownRegion, /unknown regionId/);
});

test("region_decisions reports a group without provenance instead of guessing", () => {
  // The fixture's groups all carry provenance, so strip one copy's regionId to
  // exercise the honesty branch (a repository fan-out wrapper or a pre-Gap-12
  // index looks exactly like this).
  const parsed = parseIndex(FIXTURE_INDEX_DIR);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const strippedView = (() => {
    const groupNode = [...parsed.value.hierarchy.nodes.values()].find((n) => n.kind === "group")!;
    delete groupNode.regionId;
    delete groupNode.ordinal;
    return { view: buildIndexView(FIXTURE_INDEX_DIR, parsed.value), groupId: groupNode.id };
  })();
  const message = expectFail(regionDecisions(strippedView.view, { groupId: strippedView.groupId }));
  assert.match(message, /no region provenance/);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("identical index yields byte-identical tool output across separate loads", () => {
  const reloaded = createIndexStore(FIXTURE_INDEX_DIR).load();
  assert.equal(reloaded.ok, true);
  if (!reloaded.ok) return;
  const other = reloaded.view;

  const pairs: Array<[unknown, unknown]> = [
    [repositoryOverview(view), repositoryOverview(other)],
    [hierarchyAtLevel(view, { level: 1 }), hierarchyAtLevel(other, { level: 1 })],
    [findNode(view, { query: "example" }), findNode(other, { query: "example" })],
    [nodeDetails(view, { nodeId: "file:Bootstrap.java" }), nodeDetails(other, { nodeId: "file:Bootstrap.java" })],
    [
      blastRadius(view, { nodeId: "class:src|com.example.service.UserService" }),
      blastRadius(other, { nodeId: "class:src|com.example.service.UserService" }),
    ],
    [regionDecisions(view, {}), regionDecisions(other, {})],
  ];
  for (const [a, b] of pairs) {
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  }
});

test("isAssessed implements exactly the recorded rule", () => {
  assert.equal(isAssessed({ score: 0, cohesion: 0 }), false);
  assert.equal(isAssessed({ score: 0, cohesion: 0.25 }), true);
  assert.equal(isAssessed({ score: 0.1, cohesion: 0 }), true);
  assert.equal(isAssessed({ score: 0.5, cohesion: 1.5 }), true);
});

test("limits are enforced as documented", () => {
  const overLimit = expectFail(findNode(view, { query: "a", limit: LIMITS.findMatches.max + 1 }));
  assert.match(overLimit, new RegExp(`between 1 and ${LIMITS.findMatches.max}`));
});
