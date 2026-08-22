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
 * name (R6.1).
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
 * Compose a Display_Label for every emitted hierarchy node (repository, group,
 * file). Class/function nodes are folded away in the 4-level map and are not
 * labelled.
 */
export function buildDisplayLabels(
  hierarchy: Hierarchy,
  rootName: string,
): Map<string, string> {
  const { nodes, leafAttributes } = hierarchy;
  const labels = new Map<string, string>();

  const emitted = [...nodes.values()].filter((n) => EMITTED_KINDS.has(n.kind));
  const emittedIds = new Set(emitted.map((n) => n.id));

  // Union of descendant leaf packagePaths per node, computed bottom-up
  // (children always sit at a deeper level than their parent).
  const packagePaths = new Map<string, Set<string>>();
  for (const node of [...emitted].sort((a, b) => b.level - a.level)) {
    const set = new Set<string>();
    const ownPkg = leafAttributes.get(node.id)?.packagePath;
    if (ownPkg) set.add(ownPkg);
    for (const childId of node.childIds) {
      // Emitted children carry their own rolled-up set; non-emitted children
      // (class/function leaves) contribute their packagePath directly.
      const childSet = packagePaths.get(childId);
      if (childSet) {
        for (const p of childSet) set.add(p);
      } else {
        const childPkg = leafAttributes.get(childId)?.packagePath;
        if (childPkg) set.add(childPkg);
      }
    }
    packagePaths.set(node.id, set);
  }

  // Repository + file labels are self-contained.
  for (const node of emitted) {
    if (node.kind === "repository") {
      labels.set(node.id, rootName);
    } else if (node.kind === "file") {
      labels.set(node.id, fileSimpleName(node.id));
    }
  }

  // Group labels: common package prefix, with a positional fallback and a
  // per-parent de-duplication ordinal. Processed per parent, in canonical
  // child order, so ordinals are deterministic.
  for (const parent of emitted) {
    const groupChildren = parent.childIds
      .filter((id) => emittedIds.has(id))
      .map((id) => nodes.get(id)!)
      .filter((n) => n.kind === "group");
    if (groupChildren.length === 0) continue;

    const seen = new Map<string, number>();
    groupChildren.forEach((child, index) => {
      const prefix = commonPackagePrefix(
        [...(packagePaths.get(child.id) ?? [])].sort(),
      );
      // Positional fallback when a group spans unrelated packages (R6.5).
      const base = prefix.length > 0 ? prefix : `Group ${index + 1}`;
      const occurrence = (seen.get(base) ?? 0) + 1;
      seen.set(base, occurrence);
      labels.set(child.id, occurrence === 1 ? base : `${base} \u00b7 ${occurrence}`);
    });
  }

  return labels;
}

export { fileSimpleName };
