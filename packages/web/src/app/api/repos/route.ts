import { NextResponse } from "next/server";
import { indexPresent, listRegistryRepos } from "@/lib/repohive/repo-registry";
import { repoResponseFor } from "@/lib/repohive/stub-responses";

/**
 * `GET /api/repos` — one row per registered fixture repo whose `index/` is
 * actually present on this machine.
 *
 * Read-only projection of the repo registry. Feeds the sidebar and command
 * palette so the app can boot to the Knowledge Graph surface with no backend.
 * Registered-but-absent fixtures (git-ignored on some clones) are excluded so
 * navigation never offers a repo that can only error.
 */
export async function GET() {
  const repos = listRegistryRepos().filter(indexPresent).map(repoResponseFor);
  return NextResponse.json(repos);
}
