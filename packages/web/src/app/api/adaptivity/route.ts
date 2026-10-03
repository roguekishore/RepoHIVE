import { NextResponse } from "next/server";
import { indexPresent, listRegistryRepos, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex } from "@/lib/repohive/index-loader";
import { buildAdaptivityView, countFiles, type AdaptivityInput } from "@repohive/views";

/**
 * `GET /api/adaptivity` — the cross-repository comparison.
 *
 * Not repo-scoped: the whole point is comparing repositories, so it reads every
 * registered fixture whose `index/` is present on this machine. A fixture that
 * fails to parse is skipped and named in `skipped`, rather than silently
 * dropped or faked.
 */
export async function GET() {
  const inputs: AdaptivityInput[] = [];
  const skipped: string[] = [];

  for (const entry of listRegistryRepos()) {
    if (!indexPresent(entry)) {
      skipped.push(entry.id);
      continue;
    }
    const result = loadIndex(resolveIndexDir(entry));
    if (!result.ok) {
      skipped.push(entry.id);
      continue;
    }
    inputs.push({
      id: entry.id,
      name: entry.name,
      metadata: result.value.metadata,
      files: countFiles(result.value.hierarchy),
    });
  }

  return NextResponse.json(buildAdaptivityView(inputs, skipped));
}
