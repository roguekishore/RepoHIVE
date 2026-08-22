import { NextResponse } from "next/server";
import { listRegistryRepos } from "@/lib/repohive/repo-registry";
import { repoResponseFor } from "@/lib/repohive/stub-responses";

/**
 * `GET /api/repos` — one row per registered fixture repo.
 *
 * Read-only projection of the repo registry. Feeds the sidebar and command
 * palette so the app can boot to the Knowledge Graph surface with no backend.
 */
export async function GET() {
  const repos = listRegistryRepos().map(repoResponseFor);
  return NextResponse.json(repos);
}
