import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { compareIds, sortByIds, sortEdges, sortIds, stableStringify } from "./canonical.js";
import { groupIdOf, repositoryIdOf } from "./group-id.js";
import { seededRng } from "./community.js";

/** Deterministic Fisher–Yates permutation (content unchanged). */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = seededRng(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Node-id-like strings, including ones with spaces and quotes: the membership
 * key is JSON-encoded before hashing, so ["a b"] vs ["a", "b"] must NOT
 * collide — this arbitrary deliberately covers that case.
 */
const arbitraryNodeId = fc.string({ minLength: 1, maxLength: 20 });

const arbitraryMembership = fc.uniqueArray(arbitraryNodeId, { minLength: 1, maxLength: 10 });

// Feature: hierarchical-repository-grouping, Property 22: Group identifiers are content-addressed, unique, and order-independent
test("Property 22: group ids are content-addressed, unique, and order-independent (R7.3, R7.4)", () => {
  fc.assert(
    fc.property(arbitraryMembership, arbitraryMembership, fc.nat(1_000_000), (idsA, idsB, seed) => {
      const id = groupIdOf(idsA);

      // Order-independence: any permutation of the membership yields the same id.
      assert.equal(groupIdOf(shuffled(idsA, seed)), id);

      // Stability: the id never changes across repeated calls.
      assert.equal(groupIdOf(idsA), id);

      // Content-addressed shape: fixed prefix + hex digest, no counters/randomness.
      assert.match(id, /^g_[0-9a-f]{40}$/);

      // Uniqueness: distinct membership sets yield distinct ids; equal sets, equal ids.
      const setA = new Set(idsA);
      const setB = new Set(idsB);
      const sameMembership = setA.size === setB.size && [...setA].every((x) => setB.has(x));
      if (sameMembership) {
        assert.equal(groupIdOf(idsB), id);
      } else {
        assert.notEqual(groupIdOf(idsB), id);
      }
    }),
    { numRuns: 100 }
  );
});

test("repositoryIdOf uses the same content-addressed digest under its own prefix", () => {
  const ids = ["file:b/B.java", "file:a/A.java"];
  const repoId = repositoryIdOf(ids);
  assert.match(repoId, /^r_[0-9a-f]{40}$/);
  assert.equal(repositoryIdOf([...ids].reverse()), repoId);
  // Same digest as the group scheme, distinguished only by prefix.
  assert.equal(repoId.slice(2), groupIdOf(ids).slice(2));
  assert.notEqual(repoId, groupIdOf(ids));
});

test("sortIds is permutation-invariant and ascending under compareIds", () => {
  fc.assert(
    fc.property(fc.array(fc.string()), fc.nat(1_000_000), (ids, seed) => {
      const sorted = sortIds(ids);
      assert.deepEqual(sortIds(shuffled(ids, seed)), sorted);
      assert.equal(sorted.length, ids.length);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(compareIds(sorted[i - 1]!, sorted[i]!) <= 0);
      }
    }),
    { numRuns: 100 }
  );
});

test("sortByIds is permutation-invariant and preserves elements", () => {
  fc.assert(
    fc.property(
      // Unique ids so the expected output is a single well-defined ordering.
      fc.uniqueArray(fc.record({ id: fc.string(), payload: fc.nat(100) }), {
        selector: (item) => item.id,
      }),
      fc.nat(1_000_000),
      (items, seed) => {
        const sorted = sortByIds(items);
        assert.deepEqual(sortByIds(shuffled(items, seed)), sorted);
        assert.equal(sorted.length, items.length);
        assert.deepEqual(new Set(sorted), new Set(items));
        for (let i = 1; i < sorted.length; i++) {
          assert.ok(compareIds(sorted[i - 1]!.id, sorted[i]!.id) < 0);
        }
      }
    ),
    { numRuns: 100 }
  );
});

test("sortEdges is permutation-invariant and orders by source then target", () => {
  fc.assert(
    fc.property(
      // Unique (source, target) pairs so the expected output is well defined.
      fc.uniqueArray(
        fc.record({ source: fc.string(), target: fc.string(), strength: fc.nat(100) }),
        { selector: (e) => JSON.stringify([e.source, e.target]) }
      ),
      fc.nat(1_000_000),
      (edges, seed) => {
        const sorted = sortEdges(edges);
        assert.deepEqual(sortEdges(shuffled(edges, seed)), sorted);
        assert.equal(sorted.length, edges.length);
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1]!;
          const curr = sorted[i]!;
          const bySource = compareIds(prev.source, curr.source);
          assert.ok(bySource < 0 || (bySource === 0 && compareIds(prev.target, curr.target) < 0));
        }
      }
    ),
    { numRuns: 100 }
  );
});

test("stableStringify is byte-identical across key insertion orders", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(
        fc.tuple(
          fc.string(),
          fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null))
        ),
        { selector: ([key]) => key, minLength: 1, maxLength: 10 }
      ),
      fc.nat(1_000_000),
      (entries, seed) => {
        const forward = Object.fromEntries(entries);
        const permuted = Object.fromEntries(shuffled(entries, seed));
        const out = stableStringify(forward);
        assert.equal(stableStringify(permuted), out);
        assert.ok(out.endsWith("\n"));
      }
    ),
    { numRuns: 100 }
  );
});

test("stableStringify sorts keys at every depth, ends with a newline, omits undefined entries", () => {
  const a = { beta: [1, 2, { y: true, x: null }], alpha: "s", gamma: { b: 1, a: 2 } };
  const b = { gamma: { a: 2, b: 1 }, alpha: "s", beta: [1, 2, { x: null, y: true }] };
  const out = stableStringify(a);
  assert.equal(stableStringify(b), out);
  assert.ok(out.endsWith("\n"));
  assert.equal(
    out,
    `{
  "alpha": "s",
  "beta": [
    1,
    2,
    {
      "x": null,
      "y": true
    }
  ],
  "gamma": {
    "a": 2,
    "b": 1
  }
}
`
  );

  // undefined object entries are omitted (field-omission semantics).
  assert.equal(
    stableStringify({ keep: 1, drop: undefined }),
    stableStringify({ keep: 1 })
  );
});

test("compareIds is a total order consistent with < and >", () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), fc.string(), (a, b, c) => {
      // Consistency with the code-unit relational operators.
      assert.equal(compareIds(a, b), a < b ? -1 : a > b ? 1 : 0);
      // Reflexivity and antisymmetry. (`+ 0` normalizes -0: assert.equal
      // follows Object.is, which distinguishes -0 from 0.)
      assert.equal(compareIds(a, a), 0);
      assert.equal(compareIds(a, b) + 0, -compareIds(b, a) + 0);
      // Transitivity of the non-strict order.
      if (compareIds(a, b) <= 0 && compareIds(b, c) <= 0) {
        assert.ok(compareIds(a, c) <= 0);
      }
    }),
    { numRuns: 100 }
  );
});
