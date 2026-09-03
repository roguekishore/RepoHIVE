import { NextResponse } from "next/server";
import { indexPresent, listRegistryRepos, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex } from "@/lib/repohive/index-loader";
import { adaptAdaptivity, type AdaptivityInput } from "@/lib/repohive/adaptivity-adapter";

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
    let files = 0;
    for (const node of result.value.hierarchy.nodes.values()) {
      if (node.kind === "file") files += 1;
    }
    inputs.push({
      id: entry.id,
      name: entry.name,
      metadata: result.value.metadata,
      files,
    });
  }

  const comparison = adaptAdaptivity(inputs);
  return NextResponse.json({ ...comparison, skipped: skipped.sort() });
}
