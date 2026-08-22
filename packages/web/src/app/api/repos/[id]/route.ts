import { NextResponse } from "next/server";
import { getRegistryRepo } from "@/lib/repohive/repo-registry";
import { repoResponseFor } from "@/lib/repohive/stub-responses";

/**
 * `GET /api/repos/{id}` — the single repo the repo-layout gate resolves
 * server-side before rendering any repo page. A 404 here makes that layout
 * redirect to `/`, which is the correct behaviour for an unknown repo id.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const entry = getRegistryRepo(id);
  if (!entry) {
    return NextResponse.json(
      { detail: `Unknown repository '${id}'.` },
      { status: 404 },
    );
  }
  return NextResponse.json(repoResponseFor(entry));
}
