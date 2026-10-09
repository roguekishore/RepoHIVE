import { jsonResponse } from "@/server/auth/http";
import { loadRepositorySummary } from "@/server/repositories/load-repository-page";

export const dynamic = "force-dynamic";

/** The facts a repository header shows. 404 when the repository was never indexed or the name is not GitHub-valid. */
export async function GET(_request: Request, context: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await context.params;
  const summary = await loadRepositorySummary(owner, repo);
  const headers = { "Cache-Control": "no-store" };
  if (summary === undefined) {
    return jsonResponse(
      { code: "NOT_FOUND", message: "This repository has not been indexed." },
      { status: 404, headers },
    );
  }
  return jsonResponse(summary, { status: 200, headers });
}
