// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ContractClient } from "@repohive/design/contracts";
import { loadSnapshotState } from "./snapshot-state";

const SNAPSHOT = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";

function client(overrides: Partial<ContractClient>): ContractClient {
  const unexpected = () => Promise.reject(new Error("not expected"));
  return { manifest: unexpected, snapshotPointer: unexpected, ...overrides } as unknown as ContractClient;
}

describe("loadSnapshotState", () => {
  it("uses the latest pointer, with its commit", async () => {
    const state = await loadSnapshotState(
      client({ snapshotPointer: async () => ({ snapshotId: SNAPSHOT, commitSha: "c".repeat(40) }) }),
      "acme",
      "widgets",
    );
    expect(state).toEqual({ status: "ready", snapshotId: SNAPSHOT, source: "latest", commitSha: "c".repeat(40) });
  });

  it("omits the commit when the pointer has none", async () => {
    const state = await loadSnapshotState(client({ snapshotPointer: async () => ({ snapshotId: SNAPSHOT }) }), "a", "b");
    expect(state).toEqual({ status: "ready", snapshotId: SNAPSHOT, source: "latest" });
  });

  it("says never-indexed when there is no pointer", async () => {
    expect(await loadSnapshotState(client({ snapshotPointer: async () => undefined }), "a", "b")).toEqual({
      status: "never-indexed",
    });
  });

  it("uses a requested snapshot that is still published, without reading the pointer", async () => {
    const state = await loadSnapshotState(
      client({ manifest: async () => ({}) as never }),
      "a",
      "b",
      OTHER,
    );
    expect(state).toEqual({ status: "ready", snapshotId: OTHER, source: "query" });
  });

  it("says expired when the requested snapshot is gone", async () => {
    expect(await loadSnapshotState(client({ manifest: async () => undefined }), "a", "b", OTHER)).toEqual({
      status: "expired",
      requested: OTHER,
    });
  });

  it("ignores a request that is not a snapshot id and follows the pointer", async () => {
    const state = await loadSnapshotState(
      client({ snapshotPointer: async () => ({ snapshotId: SNAPSHOT }) }),
      "a",
      "b",
      "not-an-id",
    );
    expect(state).toMatchObject({ status: "ready", source: "latest" });
  });

  it("turns a failure into an error state with its message", async () => {
    const state = await loadSnapshotState(
      client({ snapshotPointer: () => Promise.reject(new Error("The latest snapshot pointer is malformed.")) }),
      "a",
      "b",
    );
    expect(state).toEqual({ status: "error", message: "The latest snapshot pointer is malformed." });
  });
});
