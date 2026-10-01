/**
 * Display_Label composition — spec R6, implemented in exactly ONE module
 * (R6.6) so a change to node-identifier format touches nothing that renders.
 *
 * Pure and deterministic (no fs / network / clock / RNG). Tier-1 structural
 * labels per `docs/group-naming.md`:
 *   - Repository root -> the repo name.
 *   - File leaf       -> the file's simple name (basename of its path).
 *   - Group           -> the longest common package prefix of its descendant
 *                        leaves' packagePath; siblings that resolve to the same
 *                        label get a deterministic ordinal so they stay
 *                        distinguishable (R6.4); a group with no package
 *                        signal gets a positional label (R6.5).
 *
 * The raw `g_<hash>` / `file:<path>` identifiers are never used as the primary
 * name (R6.1). The package-prefix logic also serves the decision-encoding join
 * (R7), so it is exposed here as `buildGroupPackagePrefixes` and kept in this
 * one module.
 */

import type { Hierarchy } from "@repohive/core";

/** Node kinds that survive into the 4-level map (file is the leaf). */
const EMITTED_KINDS = new Set(["repository", "group", "file"]);

/** The file's simple name from its `file:<path>` identifier (R6.3). */
function fileSimpleName(id: string): string {
  const raw = id.startsWith("file:") ? id.slice("file:".length) : id;
  const segment = raw.split(/[\\/]/).filter(Boolean).pop();
  return segment ?? id;
}

/** The last dot-segment of a package path (`com.a.friend` -> `friend`). */
export function lastPackageSegment(pkg: string): string {
  const seg = pkg.split(".").filter(Boolean).pop();
  return seg ?? pkg;
}

/** Longest common dot-separated package prefix across the given paths. */
export function commonPackagePrefix(paths: readonly string[]): string {
  const split = paths.filter((p) => p.length > 0).map((p) => p.split("."));
  if (split.length === 0) return "";
  let prefix = split[0]!;
  for (let i = 1; i < split.length; i++) {
    const other = split[i]!;
    let k = 0;
    while (k < prefix.length && k < other.length && prefix[k] === other[k]) k++;
    prefix = prefix.slice(0, k);
    if (prefix.length === 0) break;
  }
  return prefix.join(".");
}

/**
 * Union of descendant leaf packagePaths per emitted node, computed bottom-up
 * (children always sit at a deeper level than their parent).
 */
function descendantPackagePaths(hierarchy: Hierarchy): Map<string, Set<string>> {
  const { nodes, leafAttributes } = hierarchy;
  const emitted = [...nodes.values()].filter((n) => EMITTED_KINDS.has(n.kind));
  const packagePaths = new Map<string, Set<string>>();
  for (const node of [...emitted].sort((a, b) => b.level - a.level)) {
    const set = new Set<string>();
    const ownPkg = leafAttributes.get(node.id)?.packagePath;
    if (ownPkg) set.add(ownPkg);
    for (const childId of node.childIds) {
      const childSet = packagePaths.get(childId);
      if (childSet) {
        for (const p of childSet) set.add(p);
      } else {
        // Non-emitted children (class/function leaves) contribute directly.
        const childPkg = leafAttributes.get(childId)?.packagePath;
        if (childPkg) set.add(childPkg);
      }
    }
    packagePaths.set(node.id, set);
  }
  return packagePaths;
}

/**
 * Raw common package prefix per group node (no ordinal, no positional
 * fallback). Empty string when a group spans unrelated packages. Used both for
 * labelling and for the decision-encoding join (R7, §7-a).
 */
export function buildGroupPackagePrefixes(hierarchy: Hierarchy): Map<string, string> {
  const packagePaths = descendantPackagePaths(hierarchy);
  const prefixes = new Map<string, string>();
  for (const node of hierarchy.nodes.values()) {
    if (node.kind !== "group") continue;
    prefixes.set(node.id, commonPackagePrefix([...(packagePaths.get(node.id) ?? [])].sort()));
  }
  return prefixes;
}

/**
 * Compose a Display_Label for every emitted hierarchy node (repository, group,
 * file). Class/function nodes are folded away in the 4-level map and are not
 * labelled.
 */
export function buildDisplayLabels(
  hierarchy: Hierarchy,
  rootName: string,
): Map<string, string> {
  const { nodes } = hierarchy;
  const labels = new Map<string, string>();
  const emitted = [...nodes.values()].filter((n) => EMITTED_KINDS.has(n.kind));
  const emittedIds = new Set(emitted.map((n) => n.id));
  const prefixes = buildGroupPackagePrefixes(hierarchy);

  // Repository + file labels are self-contained.
  for (const node of emitted) {
    if (node.kind === "repository") {
      labels.set(node.id, rootName);
    } else if (node.kind === "file") {
      labels.set(node.id, fileSimpleName(node.id));
    }
  }

  // How many groups each Region produced, so a split region can say "2 of 3"
  // rather than an opaque running number. `regionId`/`ordinal` come from the
  // engine (Gap 12); the ordinal is the piece that cannot be re-derived here,
  // because sibling groups of one region differ only by content hash.
  const groupsPerRegion = new Map<string, number>();
  for (const node of nodes.values()) {
    if (node.kind !== "group" || node.regionId === undefined) continue;
    groupsPerRegion.set(node.regionId, (groupsPerRegion.get(node.regionId) ?? 0) + 1);
  }

  // Group labels: the Region's own name where the engine recorded one, with a
  // positional suffix only when that Region produced several groups. Composition
  // stays here rather than in the engine \u2014 wording and truncation are
  // presentation policy, and a persisted label would freeze them.
  for (const parent of emitted) {
    const groupChildren = parent.childIds
      .filter((id) => emittedIds.has(id))
      .map((id) => nodes.get(id)!)
      .filter((n) => n.kind === "group");
    if (groupChildren.length === 0) continue;

    const seen = new Map<string, number>();
    groupChildren.forEach((child, index) => {
      // E2: show the readable last segment (`friend`), not the full dotted path
      // (`com.backend.springapp.friend`). The full prefix goes on the node's
      // `path` (adapter) so the hover card shows it as the subtitle.
      const regionName =
        child.regionId !== undefined ? lastPackageSegment(stripRegionScheme(child.regionId)) : "";
      const base =
        regionName.length > 0
          ? regionName
          : lastPackageSegment(prefixes.get(child.id) ?? "") || `Group ${index + 1}`;

      // A region split into several groups gets "name (2 of 3)"; a region that
      // produced exactly one keeps the bare name.
      const total = child.regionId !== undefined ? (groupsPerRegion.get(child.regionId) ?? 1) : 1;
      if (child.regionId !== undefined && child.ordinal !== undefined && total > 1) {
        labels.set(child.id, `${base} (${child.ordinal + 1} of ${total})`);
        return;
      }

      // No region provenance (a Repository fan-out wrapper): fall back to the
      // per-parent de-duplication ordinal so siblings stay distinguishable.
      const occurrence = (seen.get(base) ?? 0) + 1;
      seen.set(base, occurrence);
      labels.set(child.id, occurrence === 1 ? base : `${base} \u00b7 ${occurrence}`);
    });
  }

  return labels;
}

/** Drop a Region identifier's scheme prefix (`pkg:com.example` \u2192 `com.example`). */
function stripRegionScheme(regionId: string): string {
  const colon = regionId.indexOf(":");
  return colon === -1 ? regionId : regionId.slice(colon + 1);
}

export { fileSimpleName };
