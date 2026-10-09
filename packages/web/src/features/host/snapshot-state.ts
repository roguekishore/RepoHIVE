import type { ContractClient, SnapshotState } from "@repohive/design/contracts";
import { parseSnapshotParam } from "@/features/repository/repo-name";

/**
 * Resolves a repository page's snapshot once, from `?snapshot=<id>` when that is a valid id and otherwise from the
 * latest pointer. A page keeps the answer, so a re-index published while it is open cannot mix two snapshots. This is
 * the contract's `SnapshotState`, built through the client instead of raw `fetch`.
 */
export async function loadSnapshotState(
  client: ContractClient,
  owner: string,
  name: string,
  requestedParam?: string | null,
): Promise<SnapshotState> {
  const requested = parseSnapshotParam(requestedParam);
  try {
    if (requested !== undefined) {
      const manifest = await client.manifest(requested);
      if (manifest === undefined) return { status: "expired", requested };
      return { status: "ready", snapshotId: requested, source: "query" };
    }
    const pointer = await client.snapshotPointer(owner, name);
    if (pointer === undefined) return { status: "never-indexed" };
    return {
      status: "ready",
      snapshotId: pointer.snapshotId,
      source: "latest",
      ...(pointer.commitSha === undefined ? {} : { commitSha: pointer.commitSha }),
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Could not reach the snapshot." };
  }
}
