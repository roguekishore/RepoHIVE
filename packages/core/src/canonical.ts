/**
 * Canonical ordering + stable serialization primitives.
 *
 * Determinism rule (design, cross-cutting): any iteration over nodes or edges
 * that can affect output happens over a list sorted with these comparators —
 * never over insertion order. The stable stringifier guarantees byte-identical
 * output for equal values (fixed key order via sorted-key serialization,
 * `\n` line endings, no BOM).
 */

import { compareCanonical } from "@repohive/shared";

/**
 * Canonical lexicographic comparator for identifiers: byte-wise over the UTF-8
 * encoding, which is the order the parser has always used (R9.2, R9.3).
 *
 * This was previously JavaScript's `<`/`>`, i.e. UTF-16 code-unit order. The two
 * disagree whenever a supplementary-plane character is compared against a
 * high-BMP one, so the engine's two halves ordered the same identifiers
 * differently (Gap 17). The single implementation lives in `@repohive/shared`.
 *
 * `compareIds` feeds `sortIds`, which feeds `partitionChildren`'s slicing and
 * the content-addressed group-id membership key — so for a repository with
 * supplementary-plane identifiers this changes child ordering and group ids.
 * ASCII-only repositories are byte-for-byte unaffected.
 */
export function compareIds(a: string, b: string): number {
  return compareCanonical(a, b);
}

/** Comparator for edge-like pairs: by source, then target. */
export function compareEdgePairs(
  a: { source: string; target: string },
  b: { source: string; target: string }
): number {
  return compareIds(a.source, b.source) || compareIds(a.target, b.target);
}

/**
 * Total-order comparator for dependency edges: (source, target) first, then
 * the full signal content as a tiebreaker. Parallel edges (same source and
 * target, different content) therefore have a canonical order independent of
 * input position — without this, a stable sort would preserve input order for
 * ties and reordered input could change downstream accumulation and output
 * (Req 7.2).
 */
export function compareDependencyEdges(
  a: {
    source: string;
    target: string;
    importFrequency: number;
    methodCallFrequency: number;
    sharedTypeCount: number;
  },
  b: {
    source: string;
    target: string;
    importFrequency: number;
    methodCallFrequency: number;
    sharedTypeCount: number;
  }
): number {
  return (
    compareIds(a.source, b.source) ||
    compareIds(a.target, b.target) ||
    a.importFrequency - b.importFrequency ||
    a.methodCallFrequency - b.methodCallFrequency ||
    a.sharedTypeCount - b.sharedTypeCount
  );
}

/** Return a new array sorted by node/entity id. */
export function sortByIds<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareIds(a.id, b.id));
}

/** Return a new array of ids sorted ascending. */
export function sortIds(ids: readonly string[]): string[] {
  return [...ids].sort(compareIds);
}

/** Return a new array of edge-like values in canonical (source, target) order. */
export function sortEdges<T extends { source: string; target: string }>(edges: readonly T[]): T[] {
  return [...edges].sort(compareEdgePairs);
}

/** Indentation unit for pretty-printed output (two spaces, JSON convention). */
const INDENT_UNIT = "  ";

/**
 * Deterministic JSON serialization: object keys are emitted in sorted order
 * at every depth, so two structurally-equal values stringify byte-identically
 * regardless of property insertion order. Arrays keep their (canonical,
 * caller-sorted) order. `undefined` object entries are omitted (field-omission
 * semantics, matching the shared contract).
 *
 * Output is pretty-printed with two-space indentation and `\n` line endings
 * (no BOM) so the emitted files are human-readable. Formatting is a pure
 * function of structure, so determinism is preserved: identical values still
 * serialize byte-identically. Empty arrays and objects render compactly as
 * `[]` and `{}`.
 */
export function stableStringify(value: unknown): string {
  return `${render(value, "")}\n`;
}

function render(value: unknown, indent: string): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  const childIndent = indent + INDENT_UNIT;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const items = value.map(
      (v) => `${childIndent}${render(v === undefined ? null : v, childIndent)}`
    );
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareIds(a, b))
      .map(([k, v]) => `${childIndent}${JSON.stringify(k)}: ${render(v, childIndent)}`);
    if (entries.length === 0) {
      return "{}";
    }
    return `{\n${entries.join(",\n")}\n${indent}}`;
  }
  throw new TypeError(`stableStringify: unsupported value of type ${typeof value}`);
}
