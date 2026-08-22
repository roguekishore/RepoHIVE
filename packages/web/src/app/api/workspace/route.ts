import { NextResponse } from "next/server";
import { workspaceStub } from "@/lib/repohive/stub-responses";

/**
 * `GET /api/workspace` — always "not a workspace" for the local single-repo
 * viewer. This resolves the layout's `getWorkspace()` call (so it does not
 * throw) while keeping the workspace navigation and cross-repo surfaces hidden
 * (RepoHIVE's engine does not feed them).
 */
export async function GET() {
  return NextResponse.json(workspaceStub());
}
