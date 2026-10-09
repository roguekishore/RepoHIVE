import type { EntityKind } from "./types";

/** Encode a repo-relative file path for use inside a route, keeping slashes. */
function encodeFilePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Canonical file entity page path (relative to the repo link prefix). */
export function fileEntityPath(prefix: string, filePath: string): string {
  return `${prefix}/files/${encodeFilePath(filePath)}`;
}

/** Icon hint used by EntityLink and CommandPalette when no children supplied. */
export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  file: "File",
  symbol: "Symbol",
  decision: "Decision",
  owner: "Owner",
  commit: "Commit",
};
