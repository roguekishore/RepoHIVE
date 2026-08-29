import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { sortIds } from "./canonical.js";
import { seededRng } from "./community.js";
import type { Result } from "./errors.js";
import {
  DEFAULT_HIERARCHY_CONFIG,
  partitionChildren,
  validateHierarchyConfig,
} from "./hierarchy-builder.js";
import { groupGraph } from "./orchestrator.js";
import { arbitraryDependencyGraph } from "./test-support/arbitraries.js";
import type { RawDependencyGraph } from "@repohive/shared";
import type { Hierarchy, HierarchyConfig } from "./types.js";

/** Run the full pipeline and return the assembled hierarchy (must succeed). */
function hierarchyOf(
  graph: Parameters<typeof groupGraph>[0],
  partialConfig?: Parameters<typeof groupGraph>[1]
): Hierarchy {
  const result = groupGraph(graph, partialConfig);
  assert.ok(result.ok, "valid graph must group");
  return result.value.hierarchy;
}

/** Deterministic Fisher–Yates permutation of an id list (content unchanged). */
function shuffledIds(ids: readonly string[], seed: number): string[] {
  const rng = seededRng(seed);
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

// Feature: hierarchical-repository-grouping, Property 19: The hierarchy is a single-rooted, acyclic, fully-populated tree
test("Property 19: the hierarchy is a single-rooted, acyclic, fully-populated tree (R6.1, R6.2, R6.4, R6.5, R11.5)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const hierarchy = hierarchyOf(graph);
      const { nodes, repositoryId } = hierarchy;

      // Exactly one root: parentId null, kind "repository", level 0.
      const roots = [...nodes.values()].filter((n) => n.parentId === null);
      assert.equal(roots.length, 1, "exactly one node must have a null parentId");
      const root = roots[0]!;
      assert.equal(root.id, repositoryId);
      assert.equal(root.kind, "repository");
      assert.equal(root.level, 0);

      // Fully populated: every repository/group node has at least one child.
      for (const node of nodes.values()) {
        if (node.kind === "repository" || node.kind === "group") {
          assert.ok(node.childIds.length >= 1, `${node.kind} node ${node.id} must have children`);
        }
      }

      // The childIds arrays define exactly one parent per non-root node.
      const referenceCount = new Map<string, number>();
      for (const node of nodes.values()) {
        for (const childId of node.childIds) {
          assert.ok(nodes.has(childId), `childId ${childId} must exist in the hierarchy`);
          referenceCount.set(childId, (referenceCount.get(childId) ?? 0) + 1);
        }
      }
      for (const id of nodes.keys()) {
        const count = referenceCount.get(id) ?? 0;
        if (id === repositoryId) {
          assert.equal(count, 0, "the root must appear in no childIds list");
        } else {
          assert.equal(count, 1, `node ${id} must appear in exactly one childIds list`);
        }
      }

      // Acyclic containment: every parentId walk reaches the root, no revisits.
      for (const node of nodes.values()) {
        const visited = new Set<string>([node.id]);
        let current = node;
        while (current.parentId !== null) {
          assert.ok(!visited.has(current.parentId), "containment chain must not revisit a node");
          const parent = nodes.get(current.parentId);
          assert.ok(parent, `parent ${current.parentId} must exist in the hierarchy`);
          visited.add(parent.id);
          current = parent;
        }
        assert.equal(current.id, repositoryId, "every containment chain must end at the root");
      }

      // A file's ancestors below the root are groups only, at least two of
      // them — one expansion per group level locates the file.
      for (const node of nodes.values()) {
        if (node.kind !== "file") {
          continue;
        }
        let groupAncestors = 0;
        let current = node;
        while (current.parentId !== null) {
          const parent = nodes.get(current.parentId)!;
          if (parent.id !== repositoryId) {
            assert.equal(parent.kind, "group", `file ancestor ${parent.id} must be a Group_Node`);
            groupAncestors += 1;
          }
          current = parent;
        }
        assert.ok(groupAncestors >= 2, `file ${node.id} must sit at least two group levels deep`);
      }
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 20: Every Function is a child of its defining File
test("Property 20: every function and class is a child of its defining file (R6.3)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const hierarchy = hierarchyOf(graph);
      for (const node of hierarchy.nodes.values()) {
        if (node.kind !== "function" && node.kind !== "class") {
          continue;
        }
        const attr = hierarchy.leafAttributes.get(node.id);
        assert.ok(attr, `leaf attributes must exist for ${node.id}`);
        assert.equal(
          node.parentId,
          attr.definedInFile,
          `${node.kind} ${node.id} must hang under its defining file`
        );
      }
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 21: Group sizing is bounded and partitions are minimal
test("Property 21a: every repository/group node respects maxGroupSize (R6.7, R11.1, R11.2)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph({ maxFiles: 30 }), (graph) => {
      const hierarchy = hierarchyOf(graph, {
        hierarchy: { maxGroupSize: 5, minPartitionThreshold: 2 },
      });
      for (const node of hierarchy.nodes.values()) {
        if (node.kind === "repository" || node.kind === "group") {
          assert.ok(
            node.childIds.length <= 5,
            `${node.kind} node ${node.id} has ${node.childIds.length} children (bound 5)`
          );
        }
      }
    }),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 21: Group sizing is bounded and partitions are minimal
test("Property 21b: partitionChildren yields the fewest, balanced, order-independent slices (R6.7, R6.8, R11.1)", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 40 }),
      fc.integer({ min: 2, max: 10 }),
      fc.integer({ min: 0, max: 1000 }),
      (ids, maxGroupSize, seed) => {
        const slices = partitionChildren(ids, maxGroupSize, 2);
        const n = ids.length;

        // Fewest possible slices: ceil(n / maxGroupSize) when oversized, else one.
        const expected = n > maxGroupSize ? Math.ceil(n / maxGroupSize) : 1;
        assert.equal(slices.length, expected);

        // Every slice non-empty and within the bound; sizes differ by at most one.
        const sizes = slices.map((slice) => slice.length);
        for (const size of sizes) {
          assert.ok(size >= 1, "every slice must be non-empty");
          assert.ok(size <= maxGroupSize, "every slice must respect maxGroupSize");
        }
        assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, "slice sizes must differ by at most one");

        // Concatenation is exactly the canonically sorted input.
        assert.deepEqual(slices.flat(), sortIds(ids));

        // Input order never matters.
        assert.deepEqual(partitionChildren(shuffledIds(ids, seed), maxGroupSize, 2), slices);
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: hierarchical-repository-grouping, Property 23: Children are ordered by ascending child identifier
test("Property 23: every node's childIds array is strictly ascending (R7.5)", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph(), (graph) => {
      const hierarchy = hierarchyOf(graph);
      for (const node of hierarchy.nodes.values()) {
        for (let i = 1; i < node.childIds.length; i++) {
          assert.ok(
            node.childIds[i - 1]! < node.childIds[i]!,
            `childIds of ${node.id} must be strictly ascending`
          );
        }
      }
    }),
    { numRuns: 100 }
  );
});

function assertInvalidConfig(result: Result<HierarchyConfig>, field: string): void {
  assert.ok(!result.ok, `config violating ${field} must be rejected`);
  assert.equal(result.error.code, "INVALID_CONFIG");
  assert.ok(
    result.error.code === "INVALID_CONFIG" && result.error.detail.includes(field),
    `INVALID_CONFIG detail must name ${field}`
  );
}

test("validateHierarchyConfig rejects out-of-bounds and non-integer values naming the field (R6.6, R6.8)", () => {
  assertInvalidConfig(validateHierarchyConfig({ maxGroupSize: 1, minPartitionThreshold: 2 }), "maxGroupSize");
  assertInvalidConfig(validateHierarchyConfig({ maxGroupSize: 51, minPartitionThreshold: 2 }), "maxGroupSize");
  assertInvalidConfig(validateHierarchyConfig({ maxGroupSize: 10.5, minPartitionThreshold: 2 }), "maxGroupSize");
  assertInvalidConfig(
    validateHierarchyConfig({ maxGroupSize: 20, minPartitionThreshold: 2.5 }),
    "minPartitionThreshold"
  );
  assertInvalidConfig(
    validateHierarchyConfig({ maxGroupSize: 20, minPartitionThreshold: 1 }),
    "minPartitionThreshold"
  );
  assertInvalidConfig(
    validateHierarchyConfig({ maxGroupSize: 5, minPartitionThreshold: 6 }),
    "minPartitionThreshold"
  );
});

test("DEFAULT_HIERARCHY_CONFIG is {maxGroupSize: 20, minPartitionThreshold: 2} and validates (R6.6, R6.8)", () => {
  assert.deepEqual(DEFAULT_HIERARCHY_CONFIG, { maxGroupSize: 20, minPartitionThreshold: 2 });
  const result = validateHierarchyConfig(DEFAULT_HIERARCHY_CONFIG);
  assert.ok(result.ok);
  assert.equal(result.value, DEFAULT_HIERARCHY_CONFIG);
});

test("buildHierarchy's config gate propagates through groupGraph as INVALID_CONFIG (R6.6)", () => {
  const graph = {
    nodes: [{ id: "file:A.java", kind: "file" as const, directoryPath: "" }],
    edges: [],
  };
  const result = groupGraph(graph, { hierarchy: { maxGroupSize: 1 } });
  assert.ok(!result.ok, "invalid hierarchy config must fail the pipeline");
  assert.equal(result.error.code, "INVALID_CONFIG");
});

test("partitioning cascades deterministically through L2, L1, and the repository bound (R6.7, R11.1, R11.2)", () => {
  // 30 files in ONE package, preserve forced (boundary 0), maxGroupSize 5:
  //   L2: one 30-file group → ceil(30/5) = 6 subgroups of exactly 5
  //   L1: the region's 6 L2 groups exceed the bound → ceil(6/5) = 2 L1 groups (3 + 3)
  //   Repository: 2 children ≤ 5, no wrapping → depth exactly 3 (repo → L1 → L2 → file)
  const dir = "src/com/big";
  const files = Array.from({ length: 30 }, (_, i) => ({
    id: `file:${dir}/F${String(i).padStart(2, "0")}.java`,
    kind: "file" as const,
    packagePath: "com.big",
    directoryPath: dir,
  }));
  const hierarchy = hierarchyOf(
    { nodes: files, edges: [] },
    { structuralQualityBoundary: 0, hierarchy: { maxGroupSize: 5, minPartitionThreshold: 2 } }
  );

  const groups = [...hierarchy.nodes.values()].filter((n) => n.kind === "group");
  const level1 = groups.filter((g) => g.level === 1);
  const level2 = groups.filter((g) => g.level === 2);

  assert.equal(level2.length, 6, "30 files at maxGroupSize 5 must split into exactly 6 L2 groups");
  for (const g of level2) {
    assert.equal(g.childIds.length, 5, "balanced partitioning must yield equal 5-file slices");
    for (const childId of g.childIds) {
      assert.equal(hierarchy.nodes.get(childId)?.kind, "file");
    }
  }

  assert.equal(level1.length, 2, "6 L2 groups at maxGroupSize 5 must split into exactly 2 L1 groups");
  assert.deepEqual(level1.map((g) => g.childIds.length).sort(), [3, 3], "sizes differ by at most one");

  const repo = hierarchy.nodes.get(hierarchy.repositoryId);
  assert.ok(repo !== undefined);
  assert.equal(repo.childIds.length, 2);
  assert.equal(hierarchy.depth, 3);

  // Every file present exactly once at level 3, re-parented to a fresh subgroup id.
  const fileNodes = [...hierarchy.nodes.values()].filter((n) => n.kind === "file");
  assert.equal(fileNodes.length, 30);
  for (const f of fileNodes) {
    assert.equal(f.level, 3);
    assert.match(f.parentId ?? "", /^g_[0-9a-f]{40}$/);
  }
});

// --- Group nodes carry Region provenance (Gap 12) -------------------------
//
// A group id is a content hash, so without provenance a consumer can only show
// `g_<hash>`. The ordinal is the piece it cannot derive: when a region is
// reconstructed into several communities, or split by maxGroupSize, the sibling
// groups share a regionId and differ only by hash.

/** Group nodes carrying provenance, keyed by region. */
function groupsByRegion(hierarchy: Hierarchy): Map<string, Array<{ id: string; ordinal: number }>> {
  const byRegion = new Map<string, Array<{ id: string; ordinal: number }>>();
  for (const node of hierarchy.nodes.values()) {
    if (node.kind !== "group" || node.regionId === undefined) {
      continue;
    }
    const list = byRegion.get(node.regionId) ?? [];
    list.push({ id: node.id, ordinal: node.ordinal! });
    byRegion.set(node.regionId, list);
  }
  return byRegion;
}

test("a preserved region's groups carry its regionId, ordinals starting at 0 (Gap 12)", () => {
  const graph: RawDependencyGraph = {
    nodes: [
      { id: "file:p/A.java", kind: "file", packagePath: "p", directoryPath: "p" },
      { id: "file:p/B.java", kind: "file", packagePath: "p", directoryPath: "p" },
    ],
    edges: [
      {
        source: "file:p/A.java",
        target: "file:p/B.java",
        importFrequency: 9,
        methodCallFrequency: 0,
        sharedTypeCount: 0,
      },
    ],
  };
  // Boundary 0 preserves everywhere.
  const result = groupGraph(graph, { structuralQualityBoundary: 0 });
  assert.ok(result.ok);

  const byRegion = groupsByRegion(result.value.hierarchy);
  const groups = byRegion.get("pkg:p");
  assert.ok(groups !== undefined, "the preserved region must name its groups");
  const ordinals = groups.map((g) => g.ordinal).sort((a, b) => a - b);
  assert.equal(ordinals[0], 0, "ordinals start at 0 within each region");
});

test("repository-wrapper groups omit provenance, since they match no region", () => {
  // Enough regions to force the Repository to wrap (maxGroupSize 2).
  const nodes = Array.from({ length: 8 }, (_, i) => ({
    id: `file:p${i}/F${i}.java`,
    kind: "file" as const,
    packagePath: `p${i}`,
    directoryPath: `p${i}`,
  }));
  const result = groupGraph({ nodes, edges: [] }, { hierarchy: { maxGroupSize: 2 } });
  assert.ok(result.ok);

  const wrappers = [...result.value.hierarchy.nodes.values()].filter(
    (n) => n.kind === "group" && n.regionId === undefined,
  );
  assert.ok(wrappers.length > 0, "this shape must produce wrapper groups");
  for (const wrapper of wrappers) {
    assert.equal(wrapper.ordinal, undefined, "ordinal is omitted wherever regionId is");
  }

  // The repository node never carries provenance either.
  const repository = result.value.hierarchy.nodes.get(result.value.hierarchy.repositoryId)!;
  assert.equal(repository.regionId, undefined);
});

test("a size-partitioned region yields distinct ordinals per slice", () => {
  // 6 files in one package with maxGroupSize 2 forces several slices.
  const nodes = Array.from({ length: 6 }, (_, i) => ({
    id: `file:p/F${i}.java`,
    kind: "file" as const,
    packagePath: "p",
    directoryPath: "p",
  }));
  const result = groupGraph({ nodes, edges: [] }, { hierarchy: { maxGroupSize: 2 } });
  assert.ok(result.ok);

  const groups = groupsByRegion(result.value.hierarchy).get("pkg:p");
  assert.ok(groups !== undefined && groups.length > 1, "the region must split into several groups");
  const ordinals = groups.map((g) => g.ordinal);
  assert.equal(new Set(ordinals).size, ordinals.length, "ordinals are distinct within a region");
});

// Feature: hierarchical-repository-grouping, Property 43: Group provenance is complete and unambiguous
test("Property 43: (regionId, ordinal) is unique and every regionId is a recorded decision", () => {
  fc.assert(
    fc.property(arbitraryDependencyGraph({ maxFiles: 8, maxEdges: 12 }), (graph) => {
      const result = groupGraph(graph);
      assert.ok(result.ok);
      const { hierarchy, metadata } = result.value;

      const decided = new Set(metadata.regionDecisions.map((d) => d.regionId));
      const seen = new Set<string>();

      for (const node of hierarchy.nodes.values()) {
        if (node.kind !== "group" || node.regionId === undefined) {
          continue;
        }
        // Every provenance points at a region the audit record explains.
        assert.ok(decided.has(node.regionId), `unknown region ${node.regionId}`);
        assert.ok(Number.isInteger(node.ordinal) && node.ordinal! >= 0);

        // Uniqueness is what makes a consumer's label unambiguous: two sibling
        // groups of one region must never render as the same thing.
        const key = `${node.regionId}#${node.ordinal}`;
        assert.ok(!seen.has(key), `duplicate provenance ${key}`);
        seen.add(key);
      }

      // The reverse direction: every decision's groupIds exist in the tree.
      for (const decision of metadata.regionDecisions) {
        for (const groupId of decision.groupIds ?? []) {
          assert.ok(hierarchy.nodes.has(groupId), `decision names a missing group ${groupId}`);
        }
      }
    }),
    { numRuns: 100 },
  );
});
