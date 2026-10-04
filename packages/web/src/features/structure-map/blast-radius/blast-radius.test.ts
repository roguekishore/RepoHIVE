/**
 * The browser traversal and the session that
 * fetches the snapshot's blast-radius view once. (The comparison with the
 * removed route's baselines needed the old seed script and local store; it went
 * with them.)
 */
import { describe, expect, it } from "vitest";
import type { BlastRadiusData } from "@repohive/views";
import { createBlastRadiusSession, type BlastRadiusWorker } from "./client";
import type { WorkerRequest, WorkerResponse } from "./messages";
import {
  buildBlastRadiusIndex,
  computeBlastRadiusFromData,
} from "./traverse";

/** A worker double that runs the real traversal, so the session is tested end to end. */
function inProcessWorker(): BlastRadiusWorker {
  let listener: ((event: { data: WorkerResponse }) => void) | undefined;
  let index: ReturnType<typeof buildBlastRadiusIndex> | undefined;
  const reply = (data: WorkerResponse) => queueMicrotask(() => listener?.({ data }));
  return {
    addEventListener: (_type, l) => {
      listener = l;
    },
    postMessage(message: WorkerRequest) {
      if (message.type === "load") {
        index = buildBlastRadiusIndex(message.data);
        reply({ type: "loaded" });
      } else {
        reply({ type: "result", requestId: message.requestId, result: computeBlastRadiusFromData(index!, message.node) ?? null });
      }
    },
    terminate() {},
  };
}

const tiny: BlastRadiusData = {
  // g -> f1, f2 ; f1 -> c1 ; c1 depends on c2 (c2 is reached by c1) ; edges are [dependent, dependency].
  ids: ["c1", "c2", "f1", "f2", "g"],
  kinds: ["class", "class", "file", "file", "group"],
  parents: [2, 3, 4, 4, -1],
  children: [[], [], [0], [1], [2, 3]],
  edges: [[0, 1]],
};

describe("computeBlastRadiusFromData", () => {
  it("walks dependents backwards and rolls up to files and groups", () => {
    const result = computeBlastRadiusFromData(buildBlastRadiusIndex(tiny), "c2");
    expect(result).toEqual({ node: "c2", count: 3, ids: ["f1", "f2", "g"] });
  });

  it("seeds a group from its subtree and is cycle-safe", () => {
    const cyclic: BlastRadiusData = { ...tiny, edges: [[0, 1], [1, 0]] };
    expect(computeBlastRadiusFromData(buildBlastRadiusIndex(cyclic), "g")?.ids).toEqual(["f1", "f2", "g"]);
  });

  it("returns undefined for a node that is not in the snapshot", () => {
    expect(computeBlastRadiusFromData(buildBlastRadiusIndex(tiny), "nope")).toBeUndefined();
  });
});

describe("createBlastRadiusSession", () => {
  it("fetches the snapshot's view once, on first use, and answers through the worker", async () => {
    const urls: string[] = [];
    const session = createBlastRadiusSession({
      repoId: "acme/widgets",
      snapshotId: "0123456789abcdef0123456789abcdef",
      fetchData: async (url) => {
        urls.push(url);
        return tiny;
      },
      createWorker: inProcessWorker,
    });
    expect(urls).toEqual([]);
    const [a, b] = await Promise.all([session.query("c2"), session.query("c1")]);
    await session.query("c2");
    expect(urls).toEqual(["/artifacts/acme/widgets/0123456789abcdef0123456789abcdef/views/blast-radius.json"]);
    expect(a?.ids).toEqual(["f1", "f2", "g"]);
    expect(b?.ids).toEqual(["f1", "g"]);
    expect(await session.query("missing")).toBeNull();
    session.dispose();
  });

  it("retries the fetch after a failed first use", async () => {
    let calls = 0;
    const session = createBlastRadiusSession({
      repoId: "acme/widgets",
      snapshotId: "0123456789abcdef0123456789abcdef",
      fetchData: async () => {
        if (++calls === 1) throw new Error("offline");
        return tiny;
      },
      createWorker: inProcessWorker,
    });
    await expect(session.query("c2")).rejects.toThrow("offline");
    expect((await session.query("c2"))?.count).toBe(3);
    session.dispose();
  });
});
