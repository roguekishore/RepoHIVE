/**
 * Job SSE streams.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createMemoryJobLedger, type JobInput } from "@repohive/indexer";
import { resetAppConfigForTests } from "@/server/hosting/config";
import { resetHostingClientsForTests } from "@/server/hosting/clients";
import { GET as eventsGet } from "@/app/api/jobs/[jobId]/events/route";
import { resetJobEventStreamRegistryForTests } from "./stream-registry";

const LOCAL_ENV = {
  REPOHIVE_MODE: "local",
  REPOHIVE_SITE_ORIGIN: "http://localhost:3000",
  REPOHIVE_DATA_DIR: "data",
  REPOHIVE_STORE: "local:store",
  REPOHIVE_LEDGER: "file:ledger.json",
  REPOHIVE_ORCHESTRATOR: "local",
} as const;

function sampleInput(jobId: string): JobInput {
  return {
    jobId,
    accountId: "1",
    repo: "github.com/acme/widgets",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    tier: "S",
    snapshotId: "0123456789abcdef0123456789abcdef",
    visibility: "public",
  };
}

async function readStreamUntilDone(response: Response, maxChunks = 20): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("missing body");
  }
  let text = "";
  for (let i = 0; i < maxChunks; i += 1) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    text += new TextDecoder().decode(chunk.value);
    if (text.includes("event: done")) {
      break;
    }
  }
  reader.cancel();
  return text;
}

describe("GET /api/jobs/<jobId>/events", () => {
  beforeEach(() => {
    Object.assign(process.env, LOCAL_ENV);
    resetAppConfigForTests();
    resetJobEventStreamRegistryForTests();
  });

  it("streams progress then done for a finishing job", async () => {
    const ledger = createMemoryJobLedger();
    resetHostingClientsForTests(undefined, ledger);
    await ledger.claim(sampleInput("sse-1"));
    await ledger.transition("sse-1", "parsing");
    await ledger.writeProgress("sse-1", { stage: "parsing", completed: 2, total: 10 });

    const running = await eventsGet(
      new Request("http://localhost/api/jobs/sse-1/events", { headers: { "X-Forwarded-For": "10.0.0.1" } }),
      { params: Promise.resolve({ jobId: "sse-1" }) },
    );
    expect(running.status).toBe(200);
    const runningBody = await readStreamUntilDone(running, 5);
    expect(runningBody).toContain("event: progress");
    expect(runningBody).toContain('"stage":"parsing"');

    await ledger.finish("sse-1", { state: "succeeded" });
    const done = await eventsGet(
      new Request("http://localhost/api/jobs/sse-1/events", { headers: { "X-Forwarded-For": "10.0.0.2" } }),
      { params: Promise.resolve({ jobId: "sse-1" }) },
    );
    const doneBody = await readStreamUntilDone(done, 8);
    expect(doneBody).toContain("event: done");
    expect(doneBody).toContain('"state":"succeeded"');
  });

  it("refuses a sixth concurrent stream from one ip", async () => {
    const ledger = createMemoryJobLedger();
    resetHostingClientsForTests(undefined, ledger);
    await ledger.claim(sampleInput("sse-cap"));
    const headers = { "X-Forwarded-For": "10.0.0.9" };
    const responses: Response[] = [];
    for (let i = 0; i < 6; i += 1) {
      responses.push(
        await eventsGet(new Request("http://localhost/api/jobs/sse-cap/events", { headers }), {
          params: Promise.resolve({ jobId: "sse-cap" }),
        }),
      );
    }
    expect(responses.filter((response) => response.status === 429).length).toBe(1);
  });
});
