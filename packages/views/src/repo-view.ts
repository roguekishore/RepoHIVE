/**
 * The repository summary view (`GET /api/repos/{id}`): a registry entry
 * projected onto the viewer's `RepoResponse` shape. Every field is a fixed
 * value (no clock, no counters), so repeated builds are byte-identical.
 *
 * Moved from `packages/web`'s `stub-responses.ts` without behaviour change.
 */
import type { RepoSummary } from "./ui-types.js";

/** What the summary needs of a registry entry: `repoResponseFor` takes the web registry's entries as they are. */
export interface RepoEntry {
  id: string;
  name: string;
}

export function buildRepoView(entry: RepoEntry): RepoSummary {
  return {
    id: entry.id,
    name: entry.name,
    url: "",
    local_path: "",
    default_branch: "main",
    head_commit: null,
    settings: {},
    created_at: "",
    updated_at: "",
    workspace_status: "indexed",
    docs_mode: "none",
  };
}
