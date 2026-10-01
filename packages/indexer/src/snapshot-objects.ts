/**
 * Turns the views and the index files into the snapshot's objects, with the
 * keys the layout fixes (hosting-2 Requirements 6 and 7). Every object is a pure
 * function of the snapshot inputs.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { INDEX_FILE_NAMES } from "@repohive/core";
import type { SnapshotViews } from "@repohive/views";
import {
  VIEW_FILES,
  architectureLevelKey,
  indexObjectKey,
  jsonBytes,
  regionDetailKey,
  viewKey,
  type SnapshotObject,
} from "./layout.js";

/** The view objects of `snapshotId`: `JSON.stringify` of each view, UTF-8, no trailing newline. */
export function viewObjects(snapshotId: string, views: SnapshotViews): SnapshotObject[] {
  const object = (file: (typeof VIEW_FILES)[keyof typeof VIEW_FILES], value: unknown): SnapshotObject => ({
    key: viewKey(snapshotId, file),
    content: jsonBytes(value),
  });
  return [
    object(VIEW_FILES.repo, views.repo),
    object(VIEW_FILES.graph, views.graph),
    object(VIEW_FILES.adaptivity, views.adaptivity),
    object(VIEW_FILES.hierarchyScale, views.hierarchyScale),
    object(VIEW_FILES.regionDecisions, views.regionDecisions),
    object(VIEW_FILES.zoomMap, views.zoomMap),
    object(VIEW_FILES.architecture, views.architecture),
    object(VIEW_FILES.regionDetailIndex, views.regionDetailIndex),
    object(VIEW_FILES.blastRadius, views.blastRadius),
    ...views.architectureLevels.map((view, n) => ({
      key: architectureLevelKey(snapshotId, n),
      content: jsonBytes(view),
    })),
    ...views.regionDetails.map((view, n) => ({ key: regionDetailKey(snapshotId, n), content: jsonBytes(view) })),
  ];
}

/** The compact index files the engine wrote to `indexDirectory`, as `idx/<snapshotId>/<name>` objects. */
export async function indexObjects(snapshotId: string, indexDirectory: string): Promise<SnapshotObject[]> {
  return Promise.all(
    INDEX_FILE_NAMES.map(async (name) => ({
      key: indexObjectKey(snapshotId, name),
      content: await readFile(join(indexDirectory, name)),
    })),
  );
}
