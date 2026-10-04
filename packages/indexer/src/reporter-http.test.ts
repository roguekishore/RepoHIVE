/**
 * The HTTP reporter and active-snapshot reader against an injected `fetch` and clock.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FetchFunction } from "./github.js";
import { createHttpActiveSnapshotReader, createHttpJobReporter } from "./reporter-http.js";
import { PROGRESS_WRITE_INTERVAL_MS } from "./job-states.js";

const SECRET = "internal-secret-do-not-log";
const URL_BASE = "https://app.example.com";

interface Recorded {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown> | undefined;
}

/** A fetch that answers with `statuses` in turn (the last repeats), recording each request. */
function fakeFetch(statuses: (number | Error)[] = [204]): { fetch: FetchFunction; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetch: FetchFunction = async (url, init) => {
    calls.push({
      url,
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    });
    const next = statuses[Math.min(calls.length - 1, statuses.length - 1)]!;
    if (next instanceof Error) {
      throw next;
    }
    return new Response(null, { status: next });
  };
  return { fetch, calls };
}

function reporterWith(statuses: (number | Error)[] = [204]) {
  const { fetch, calls } = fakeFetch(statuses);
  const sleeps: number[] = [];
  const warnings: string[] = [];
  let clock = 1_000_000;
  const reporter = createHttpJobReporter({
    serverUrl: `${URL_BASE}/`,
    secret: SECRET,
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => clock,
    warn: (message) => warnings.push(message),
  });
  return { reporter, calls, sleeps, warnings, advance: (ms: number) => (clock += ms) };
}

describe("reporter: requests", () => {
  test("posts progress with the bearer secret and a JSON body", async () => {
    const { reporter, calls } = reporterWith();
    await reporter.progress("job-1", { state: "fetching" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, `${URL_BASE}/api/internal/jobs/progress`);
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.headers.Authorization, `Bearer ${SECRET}`);
    assert.equal(calls[0]?.headers["Content-Type"], "application/json");
    assert.deepEqual(calls[0]?.body, { jobId: "job-1", state: "fetching" });
  });

  test("a progress report carries stage and counts", async () => {
    const { reporter, calls } = reporterWith();
    await reporter.progress("job-1", { progress: { stage: "parse", completed: 10, total: 2985 } });
    assert.deepEqual(calls[0]?.body, { jobId: "job-1", progress: { stage: "parse", completed: 10, total: 2985 } });
  });

  test("complete posts each outcome shape to the complete endpoint", async () => {
    const outcomes = [
      {
        status: "succeeded",
        snapshotId: "a".repeat(32),
        commitSha: "b".repeat(40),
        engineVersion: "e1",
        viewsVersion: "v1",
        nodeCount: 1234,
        edgeCount: 5678,
      },
      { status: "failed", failureClass: "system", failureCode: "TIME_LIMIT", message: "Indexing took too long and was stopped." },
      { status: "retier", tier: "L" },
    ] as const;
    for (const outcome of outcomes) {
      const { reporter, calls } = reporterWith();
      await reporter.complete("job-9", outcome);
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.url, `${URL_BASE}/api/internal/jobs/complete`);
      assert.equal(calls[0]?.headers.Authorization, `Bearer ${SECRET}`);
      assert.deepEqual(calls[0]?.body, { jobId: "job-9", ...outcome });
    }
  });
});

describe("reporter: throttling", () => {
  test("progress-only updates go out at most once per 2 s, keeping the latest", async () => {
    const { reporter, calls, advance } = reporterWith();
    assert.equal(PROGRESS_WRITE_INTERVAL_MS, 2000);
    await reporter.progress("j", { progress: { stage: "parse", completed: 1 } });
    assert.equal(calls.length, 1, "the first goes out at once");
    advance(500);
    await reporter.progress("j", { progress: { stage: "parse", completed: 2 } });
    advance(500);
    await reporter.progress("j", { progress: { stage: "parse", completed: 3 } });
    assert.equal(calls.length, 1, "held back inside the interval");
    advance(1000);
    await reporter.progress("j", { progress: { stage: "parse", completed: 4 } });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1]?.body?.progress, { stage: "parse", completed: 4 });
  });

  test("a state change is sent at once, with the pending progress", async () => {
    const { reporter, calls, advance } = reporterWith();
    await reporter.progress("j", { progress: { stage: "parse", completed: 1 } });
    advance(100);
    await reporter.progress("j", { progress: { stage: "parse", completed: 2 } });
    advance(100);
    await reporter.progress("j", { state: "grouping" });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1]?.body, { jobId: "j", state: "grouping", progress: { stage: "parse", completed: 2 } });
    // The pending progress was consumed: the next progress-only update waits for a new interval.
    advance(100);
    await reporter.progress("j", { progress: { stage: "group", completed: 1 } });
    assert.equal(calls.length, 2);
  });

  test("a state change with its own progress sends that progress, not the stale one", async () => {
    const { reporter, calls, advance } = reporterWith();
    await reporter.progress("j", { progress: { stage: "a" } });
    advance(10);
    await reporter.progress("j", { progress: { stage: "b" } });
    await reporter.progress("j", { state: "parsing", progress: { stage: "c" } });
    assert.deepEqual(calls[1]?.body, { jobId: "j", state: "parsing", progress: { stage: "c" } });
  });

  test("complete flushes pending progress first", async () => {
    const { reporter, calls, advance } = reporterWith();
    await reporter.progress("j", { progress: { stage: "parse", completed: 1 } });
    advance(10);
    await reporter.progress("j", { progress: { stage: "parse", completed: 2 } });
    await reporter.complete("j", { status: "retier", tier: "M" });
    assert.deepEqual(
      calls.map((call) => call.url.replace(URL_BASE, "")),
      ["/api/internal/jobs/progress", "/api/internal/jobs/progress", "/api/internal/jobs/complete"],
    );
    assert.deepEqual(calls[1]?.body?.progress, { stage: "parse", completed: 2 });
  });

  test("throttling is kept per job", async () => {
    const { reporter, calls } = reporterWith();
    await reporter.progress("a", { progress: { stage: "x" } });
    await reporter.progress("b", { progress: { stage: "x" } });
    assert.equal(calls.length, 2);
  });
});

describe("reporter: retries and failures", () => {
  test("retries a 5xx with 1 s then 2 s backoff, then succeeds", async () => {
    const { reporter, calls, sleeps } = reporterWith([503, 502, 204]);
    await reporter.complete("j", { status: "retier", tier: "M" });
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [1000, 2000]);
  });

  test("retries a network error", async () => {
    const { reporter, calls, sleeps } = reporterWith([new TypeError(`fetch failed for ${SECRET}`), 204]);
    await reporter.complete("j", { status: "retier", tier: "M" });
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [1000]);
  });

  test("complete throws after three failed attempts, without the secret in the message", async () => {
    const { reporter, calls } = reporterWith([500]);
    await assert.rejects(reporter.complete("j", { status: "retier", tier: "M" }), (error: Error) => {
      assert.match(error.message, /HTTP 500/);
      assert.ok(!error.message.includes(SECRET));
      return true;
    });
    assert.equal(calls.length, 3);
  });

  test("a network error never leaks its text into the error", async () => {
    const { reporter } = reporterWith([new TypeError(`connect failed with ${SECRET}`)]);
    await assert.rejects(reporter.complete("j", { status: "retier", tier: "M" }), (error: Error) => {
      assert.ok(!error.message.includes(SECRET));
      return true;
    });
  });

  test("401, 404 and other 4xx make complete throw at once, without retrying", async () => {
    for (const status of [401, 404, 400, 422]) {
      const { reporter, calls, sleeps } = reporterWith([status]);
      await assert.rejects(reporter.complete("j", { status: "retier", tier: "M" }), new RegExp(`HTTP ${status}`));
      assert.equal(calls.length, 1);
      assert.deepEqual(sleeps, []);
    }
  });

  test("progress swallows a 4xx or exhausted retries into a warning without the secret", async () => {
    for (const statuses of [[401], [404], [500]]) {
      const { reporter, warnings } = reporterWith(statuses);
      await reporter.progress("j", { state: "fetching" });
      assert.equal(warnings.length, 1);
      assert.ok(!warnings[0]!.includes(SECRET));
    }
  });

  test("a 409 on progress stops all further progress for the job, without an error", async () => {
    const { reporter, calls, advance, warnings } = reporterWith([409]);
    await reporter.progress("j", { state: "fetching" });
    assert.equal(calls.length, 1);
    advance(10_000);
    await reporter.progress("j", { state: "parsing" });
    await reporter.progress("j", { progress: { stage: "parse" } });
    assert.equal(calls.length, 1);
    assert.deepEqual(warnings, []);
    // Another job is unaffected.
    await reporter.progress("other", { state: "fetching" });
    assert.equal(calls.length, 2);
  });

  test("a 409 on complete resolves without error", async () => {
    const { reporter, calls } = reporterWith([409]);
    await reporter.complete("j", { status: "failed", failureClass: "system", failureCode: "X", message: "m" });
    assert.equal(calls.length, 1);
  });

  test("after a 409 the pending progress is not flushed by complete", async () => {
    const { reporter, calls } = reporterWith([409]);
    await reporter.progress("j", { state: "fetching" });
    await reporter.progress("j", { progress: { stage: "p" } });
    await reporter.complete("j", { status: "retier", tier: "M" });
    assert.deepEqual(
      calls.map((call) => call.url.replace(URL_BASE, "")),
      ["/api/internal/jobs/progress", "/api/internal/jobs/complete"],
    );
  });
});

describe("active snapshot reader", () => {
  function reader(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const read = createHttpActiveSnapshotReader({
      serverUrl: `${URL_BASE}/`,
      secret: SECRET,
      fetch: async (url, init) => {
        calls.push({ url, ...(init === undefined ? {} : { init }) });
        return respond(url, init);
      },
    });
    return { read, calls };
  }

  test("asks the server for the repo's active snapshot with the bearer secret", async () => {
    const { read, calls } = reader(() => Response.json({ snapshotId: "a".repeat(32) }));
    assert.equal(await read("github.com/acme/widgets"), "a".repeat(32));
    assert.equal(calls[0]?.url, `${URL_BASE}/api/internal/repos/acme/widgets/active`);
    assert.equal(calls[0]?.init?.method, "GET");
    assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, `Bearer ${SECRET}`);
  });

  test("a null snapshot id is undefined", async () => {
    const { read } = reader(() => Response.json({ snapshotId: null }));
    assert.equal(await read("github.com/acme/widgets"), undefined);
  });

  test("any failure throws, without the secret in the message", async () => {
    for (const respond of [
      () => new Response("", { status: 401 }),
      () => new Response("", { status: 500 }),
      () => new Response("not json", { status: 200 }),
      () => Response.json({ snapshotId: 5 }),
      (): Response => {
        throw new TypeError(`boom ${SECRET}`);
      },
    ]) {
      const { read } = reader(respond);
      await assert.rejects(read("github.com/acme/widgets"), (error: Error) => !error.message.includes(SECRET));
    }
  });

  test("a repo that is not a canonical key is refused before any request", async () => {
    const { read, calls } = reader(() => Response.json({ snapshotId: null }));
    await assert.rejects(read("acme/widgets"), RangeError);
    await assert.rejects(read("github.com/acme/../x"), RangeError);
    assert.equal(calls.length, 0);
  });
});
