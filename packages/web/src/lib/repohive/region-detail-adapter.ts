/**
 * Region_Detail adapter — the pure projection behind the boundary-morph and
 * provenance surfaces: one region's recorded decision joined to its file
 * membership, its authored partition (packagePath), its derived partition
 * (the engine's recorded region→group provenance), and the recorded
 * dependency edges among those files.
 *
 * Follows the house adapter convention (`zoom-map-adapter.ts`): pure — no fs,
 * network, clock or RNG; joins by engine-recorded ids (`regionId`, Gap 12),
 * never path heuristics; canonical ordering everywhere with id tie-breaks;
 * nothing is computed that the engine did not record — the only arithmetic is
 * counting and summing what is already in the index.
 */

import type { Hierarchy, HierarchyNode, Metadata, RegionDecision } from "@repohive/core";
import type { MorphCell, MorphEdge, MorphFile } from "@repohive/ui/repohive";
import { fileSimpleName } from "./zoom-labels";

/** Drop a Region identifier's scheme prefix (`pkg:com.example` → `com.example`). */
export function stripRegionScheme(regionId: string): string {
  const colon = regionId.indexOf(":");
  return colon === -1 ? regionId : regionId.slice(colon + 1);
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * File membership per region: a file belongs to the region recorded on its
 * nearest ancestor group (Gap 12). Files whose ancestry carries no region
 * (repository fan-out wrappers all the way up) belong to no region and are
 * omitted — that absence is engine-recorded, not an adapter guess.
 *
 * Returns file ids in canonical (ascending id) order per region.
 */
export function regionFileMembership(hierarchy: Hierarchy): Map<string, string[]> {
  const { nodes } = hierarchy;
  const membership = new Map<string, string[]>();
  for (const node of nodes.values()) {
    if (node.kind !== "file") continue;
    let cursor: HierarchyNode | undefined = node.parentId ? nodes.get(node.parentId) : undefined;
    while (cursor && cursor.regionId === undefined) {
      cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
    }
    if (!cursor?.regionId) continue;
    const list = membership.get(cursor.regionId);
    if (list) list.push(node.id);
    else membership.set(cursor.regionId, [node.id]);
  }
  for (const list of membership.values()) list.sort(byId);
  return membership;
}

export interface RegionDetail {
  regionId: string;
  displayName: string;
  decision: RegionDecision;
  boundary: number;
  metricWeights: Metadata["metricWeights"];
  cohesionSquashConstant: number;
  /** Recorded community-detection seed, when the index carries its configuration. */
  seed: number | null;
  files: MorphFile[];
  authored: MorphCell[];
  derived: MorphCell[];
  edges: MorphEdge[];
  /** Files dropped by the deterministic size cap (0 = none). */
  truncatedFiles: number;
}

/**
 * Deterministic size cap for the morph. A region is bounded by
 * maxGroupSize × its group count, which can reach hundreds of files on a
 * large repository; past this many the tiles stop being readable anyway.
 */
export const MORPH_FILE_CAP = 150;

/**
 * Project one region onto the morph/provenance contract, or `null` when the
 * region is not in the recorded decision list.
 */
export function adaptRegionDetail(
  hierarchy: Hierarchy,
  metadata: Metadata,
  regionId: string,
  fileCap: number = MORPH_FILE_CAP,
): RegionDetail | null {
  const decision = metadata.regionDecisions.find((d) => d.regionId === regionId);
  if (!decision) return null;

  const { nodes, leafAttributes, leafEdges } = hierarchy;
  const memberIds = regionFileMembership(hierarchy).get(regionId) ?? [];

  // --- Edges: recorded leaf edges lifted to their containing files, both ----
  // endpoints inside the region, aggregated per unordered pair.
  const fileAncestor = (id: string): string | null => {
    let cursor = nodes.get(id);
    while (cursor && cursor.kind !== "file") {
      cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
    }
    return cursor ? cursor.id : null;
  };

  const memberSet = new Set(memberIds);
  const pairStrength = new Map<string, { a: string; b: string; strength: number }>();
  for (const edge of leafEdges) {
    const source = fileAncestor(edge.source);
    const target = fileAncestor(edge.target);
    if (!source || !target || source === target) continue;
    if (!memberSet.has(source) || !memberSet.has(target)) continue;
    const [a, b] = source < target ? [source, target] : [target, source];
    const key = `${a}\u0000${b}`;
    const existing = pairStrength.get(key);
    if (existing) existing.strength += edge.strength;
    else pairStrength.set(key, { a, b, strength: edge.strength });
  }

  // --- Deterministic cap: keep the most-connected files (summed incident ----
  // strength, id tie-break) so what remains is the structure worth seeing.
  let keptIds = memberIds;
  let truncatedFiles = 0;
  if (memberIds.length > fileCap) {
    const incident = new Map<string, number>(memberIds.map((id) => [id, 0]));
    for (const { a, b, strength } of pairStrength.values()) {
      incident.set(a, (incident.get(a) ?? 0) + strength);
      incident.set(b, (incident.get(b) ?? 0) + strength);
    }
    keptIds = [...memberIds]
      .sort((x, y) => (incident.get(y) ?? 0) - (incident.get(x) ?? 0) || byId(x, y))
      .slice(0, fileCap)
      .sort(byId);
    truncatedFiles = memberIds.length - keptIds.length;
  }
  const keptSet = new Set(keptIds);

  const files: MorphFile[] = keptIds.map((id) => ({
    id,
    name: fileSimpleName(id),
    packagePath: leafAttributes.get(id)?.packagePath ?? "",
  }));

  // --- Authored partition: the boundary the author wrote (packagePath). -----
  const authoredByPackage = new Map<string, string[]>();
  for (const file of files) {
    const key = file.packagePath;
    const list = authoredByPackage.get(key);
    if (list) list.push(file.id);
    else authoredByPackage.set(key, [file.id]);
  }
  const authored: MorphCell[] = [...authoredByPackage.entries()]
    .sort(([a], [b]) => byId(a, b))
    .map(([pkg, fileIds]) => ({
      id: `pkg:${pkg}`,
      label: pkg === "" ? "(no package)" : pkg,
      fileIds,
    }));

  // --- Derived partition: the groups the engine recorded for this region. ---
  // A file's cell is its nearest regioned ancestor group; cells order by the
  // engine's recorded ordinal, id tie-break.
  const cellFiles = new Map<string, string[]>();
  for (const fileId of keptIds) {
    let cursor = nodes.get(fileId);
    cursor = cursor?.parentId ? nodes.get(cursor.parentId) : undefined;
    while (cursor && cursor.regionId === undefined) {
      cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
    }
    if (!cursor || cursor.regionId !== regionId) continue;
    const list = cellFiles.get(cursor.id);
    if (list) list.push(fileId);
    else cellFiles.set(cursor.id, [fileId]);
  }
  const cellNoun = decision.action === "preserve" ? "slice" : "cluster";
  const orderedCells = [...cellFiles.keys()].sort((a, b) => {
    const na = nodes.get(a)?.ordinal ?? Number.MAX_SAFE_INTEGER;
    const nb = nodes.get(b)?.ordinal ?? Number.MAX_SAFE_INTEGER;
    return na - nb || byId(a, b);
  });
  const derived: MorphCell[] = orderedCells.map((groupId, index) => ({
    id: groupId,
    label:
      orderedCells.length === 1
        ? stripRegionScheme(regionId)
        : `${cellNoun} ${index + 1} of ${orderedCells.length}`,
    fileIds: cellFiles.get(groupId)!,
  }));

  const edges: MorphEdge[] = [...pairStrength.values()]
    .filter(({ a, b }) => keptSet.has(a) && keptSet.has(b))
    .map(({ a, b, strength }) => ({ source: a, target: b, strength }))
    .sort((x, y) => byId(x.source, y.source) || byId(x.target, y.target));

  return {
    regionId,
    displayName: stripRegionScheme(regionId),
    decision,
    boundary: metadata.structuralQualityBoundary,
    metricWeights: metadata.metricWeights,
    cohesionSquashConstant: metadata.cohesionSquashConstant,
    seed: metadata.configuration?.communityDetectionSeed ?? null,
    files,
    authored,
    derived,
    edges,
    truncatedFiles,
  };
}
