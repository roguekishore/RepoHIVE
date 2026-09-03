import { NextResponse } from "next/server";
import { getRegistryRepo, resolveIndexDir } from "@/lib/repohive/repo-registry";
import { loadIndex, describeError } from "@/lib/repohive/index-loader";
import {
  adaptDeterminism,
  adaptFragmentation,
  adaptGroupDsm,
  adaptLevelFlow,
} from "@/lib/repohive/architecture-adapter";

/**
 * `GET /api/graph/{id}/architecture` — the three recorded structural artifacts:
 * the per-level flow, the group-to-group DSM, and the determinism evidence.
 *
 * `?level=` overrides the DSM's level; by default the adapter picks the deepest
 * level whose group count still fits the matrix budget.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const entry = getRegistryRepo(id);
  if (!entry) {
    return NextResponse.json(
      { detail: `Unknown repository '${id}'.`, code: "UNKNOWN_REPO" },
      { status: 404 },
    );
  }

  const result = loadIndex(resolveIndexDir(entry));
  if (!result.ok) {
    const status = result.error.code === "MISSING_FILES" ? 404 : 500;
    return NextResponse.json(
      { detail: describeError(result.error), code: result.error.code },
      { status },
    );
  }

  const { hierarchy, metadata } = result.value;
  const levelParam = new URL(request.url).searchParams.get("level");
  const level =
    levelParam !== null && Number.isInteger(Number(levelParam)) ? Number(levelParam) : undefined;

  return NextResponse.json({
    levels: adaptLevelFlow(metadata),
    dsm: adaptGroupDsm(hierarchy, metadata, level),
    fragmentation: adaptFragmentation(hierarchy, metadata),
    determinism: adaptDeterminism(hierarchy, metadata),
    availableLevels: metadata.perLevel
      .filter((row) => row.groupNodeCount > 1)
      .map((row) => ({ level: row.level, groupNodeCount: row.groupNodeCount })),
  });
}
