/**
 * Minimal, deterministic stub payloads that let the vendored app boot to the
 * one real surface (Knowledge Graph) with no backend.
 *
 * These mirror the vendored response shapes verbatim (`RepoResponse`,
 * `WorkspaceResponse`) so the render components stay untouched (protocol §5).
 * Every field is a fixed value — no clock, no counters — so repeated boots are
 * byte-identical (spec R8).
 */

import type { RepoResponse, WorkspaceResponse } from "@repohive/api-client/types";
import type { RepoRegistryEntry } from "./repo-registry";

/** A registry entry projected onto the vendored `RepoResponse` shape. */
export function repoResponseFor(entry: RepoRegistryEntry): RepoResponse {
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

/**
 * A "not a workspace" response. This hides the workspace navigation and the
 * cross-repo surfaces (which RepoHIVE's engine does not feed) while letting the
 * layout's `getWorkspace()` call resolve instead of throwing.
 */
export function workspaceStub(): WorkspaceResponse {
  return {
    is_workspace: false,
    workspace_root: null,
    workspace_name: null,
    repos: [],
    default_repo: null,
    cross_repo_summary: null,
    contract_summary: null,
  };
}
