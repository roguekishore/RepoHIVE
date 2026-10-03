/**
 * The browser traversal gives the removed
 * route's output for the seeded sample, and the view is fetched once.
 *
 * The comparison needs the recorded baselines (`.agents/baselines/hosting-3/`) and
 * a seeded local store (`npm run seed --workspace @repohive/web`); both are
 * git-ignored, so the comparison is skipped when either is absent. Broadleaf is
 * compared the same way once it is seeded (phase H).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createLocalArtifactStore, latestKey, type LatestPointer } from "@repohive/indexer";
import type { BlastRadiusData } from "@repohive/views";
import { createBlastRadiusSession, type BlastRadiusWorker } from "./client";
import type { WorkerRequest, WorkerResponse } from "./messages";
import {
  buildBlastRadiusIndex,
  computeBlastRadiusFromData,
  type BlastRadiusResult,
} from "./traverse";

const repoRoot = path.resolve(__dirname, "../../../../..");
const storeDir = path.join(repoRoot, ".repohive-local", "store");

interface Baseline {
  results: { node: string; result: BlastRadiusResult }[];
}

function readBaseline(fixture: string): Baseline | undefined {
  const file = path.join(repoRoot, ".agents", "baselines", "hosting-3", fixture, "routes", "blast-radius.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Baseline) : undefined;
}

async function readSeededView(repo: string): Promise<{ id: string; data: BlastRadiusData } | undefined> {
  if (!existsSync(storeDir)) return undefined;
  const store = createLocalArtifactStore(storeDir);
  const latest = await store.get(latestKey(`github.com/${repo}`));
  if (latest === undefined) return undefined;
  const pointer = JSON.parse(Buffer.from(latest.body).toString("utf8")) as LatestPointer;
  const view = await store.get(`s/${pointer.snapshotId}/views/blast-radius.json`);
  if (view === undefined) return undefined;
  const bytes = view.headers.contentEncoding === "br" ? brotliDecompressSync(view.body) : view.body;
  return { id: pointer.snapshotId, data: JSON.parse(Buffer.from(bytes).toString("utf8")) as BlastRadiusData };
}

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

async function assertBaselineBlastRadius(fixture: string, repo: string) {
  const baseline = readBaseline(fixture);
  const seeded = await readSeededView(repo);
  if (baseline === undefined || seeded === undefined) {
    console.warn(`skipped: baseline or seeded ${fixture} snapshot is absent`);
    return;
  }
  const index = buildBlastRadiusIndex(seeded.data);
  expect(baseline.results.length).toBeGreaterThan(0);
  for (const { node, result } of baseline.results) {
    expect(computeBlastRadiusFromData(index, node), node).toEqual(result);
  }
}

describe("blast radius equals the removed route's output (R4.3)", () => {
  it("sample-java-project: 100-node seeded sample", async () => {
    await assertBaselineBlastRadius("sample-java-project", "local/sample-java-project");
  });

  it("BroadleafCommerce: 100-node seeded sample", async () => {
    await assertBaselineBlastRadius("BroadleafCommerce", "local/broadleafcommerce");
  }, 120_000);
});

describe("createBlastRadiusSession", () => {
  it("fetches the snapshot's view once, on first use, and answers through the worker", async () => {
    const urls: string[] = [];
    const session = createBlastRadiusSession({
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
    expect(urls).toEqual(["/s/0123456789abcdef0123456789abcdef/views/blast-radius.json"]);
    expect(a?.ids).toEqual(["f1", "f2", "g"]);
    expect(b?.ids).toEqual(["f1", "g"]);
    expect(await session.query("missing")).toBeNull();
    session.dispose();
  });

  it("retries the fetch after a failed first use", async () => {
    let calls = 0;
    const session = createBlastRadiusSession({
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
