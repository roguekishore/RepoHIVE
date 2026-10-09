import { jsonResponse } from "@/server/auth/http";
import { loadRepositoryPage } from "@/server/repositories/load-repository-page";

export const dynamic = "force-dynamic";

/** The paged list of indexed repositories, the same item and page shape the Java server serves. */
export async function GET(request: Request) {
  const page = await loadRepositoryPage(new URL(request.url).searchParams.get("page"));
  return jsonResponse(page, { status: 200, headers: { "Cache-Control": "no-store" } });
}
