/**
 * HTTP-level end-to-end checks against the Spring Boot server in local mode.
 *
 *   node scripts/e2e.mjs
 *
 * Spawns `repohive-server.jar` with an isolated data directory, then drives sign-up,
 * intake, SSE progress, cache hits, quota, limits and a system-failure refund (a
 * second server pass with `REPOHIVE_LOCAL_JOB_INJECT_FAILURE=system`). The server
 * runs the indexer as a child process, so the root build must have run.
 *
 * Environment: `REPOHIVE_E2E_PORT` (default 3299), `REPOHIVE_E2E_JAR`
 * (default `repohive-server/target/repohive-server.jar`), `REPOHIVE_JAVA` (default `java`).
 * Build the jar first: `./mvnw -B package` in `repohive-server/` (Java 21 or newer).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const serverRoot = path.join(repoRoot, "repohive-server");
const jarPath = process.env.REPOHIVE_E2E_JAR ?? path.join(serverRoot, "target", "repohive-server.jar");
const javaBin = process.env.REPOHIVE_JAVA ?? "java";
const port = process.env.REPOHIVE_E2E_PORT ?? "3299";
const origin = `http://127.0.0.1:${port}`;
const runId = randomBytes(4).toString("hex");
const email = (label) => `${label}-${runId}@example.com`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message, detail) {
  if (!condition) {
    throw new Error(detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`);
  }
}

async function waitForHealth(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) {
        const body = await response.json();
        if (body.status === "ok" || body.status === "degraded") {
          return;
        }
      }
    } catch {
      // retry
    }
    await sleep(500);
  }
  throw new Error("server did not become healthy");
}

function killProcessTree(child) {
  if (child.killed || child.pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore", shell: true });
  } else {
    child.kill("SIGTERM");
  }
}

function startStack(scratch, extraEnv) {
  if (!existsSync(jarPath)) {
    throw new Error(`server jar not found at ${jarPath}; run ./mvnw -B package in repohive-server/`);
  }
  mkdirSync(path.join(scratch, "data"), { recursive: true });
  mkdirSync(path.join(scratch, "store"), { recursive: true });
  const env = {
    ...process.env,
    ...extraEnv,
    REPOHIVE_SITE_ORIGIN: origin,
    REPOHIVE_SERVER_URL: origin,
    REPOHIVE_DATA_DIR: path.join(scratch, "data"),
    REPOHIVE_STORE: `local:${path.join(scratch, "store")}`,
    SERVER_PORT: port,
  };
  // The working directory is the server's, so `config/local.env` and its relative paths apply.
  const server = spawn(javaBin, ["-jar", jarPath], { cwd: serverRoot, env, stdio: "pipe" });
  server.stderr?.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  server.stdout?.on("data", () => {});
  return {
    env,
    stop() {
      killProcessTree(server);
    },
  };
}

function cookieHeader(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  const legacy = response.headers.get("set-cookie");
  const parts = raw.length > 0 ? raw : legacy ? [legacy] : [];
  return parts.map((line) => line.split(";")[0]).join("; ");
}

async function jsonPost(pathname, body, cookie = "") {
  const headers = {
    "Content-Type": "application/json",
    Origin: origin,
  };
  if (cookie !== "") {
    headers.Cookie = cookie;
  }
  const response = await fetch(`${origin}${pathname}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { response, body: parsed, cookie: cookieHeader(response) || cookie };
}

async function jsonGet(pathname, cookie = "") {
  const headers = cookie === "" ? {} : { Cookie: cookie };
  const response = await fetch(`${origin}${pathname}`, { headers });
  const body = await response.json();
  return { response, body };
}

async function waitForJobTerminal(jobId, cookie, timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await jsonGet(`/api/jobs/${jobId}`, cookie);
    if (body.state === "succeeded" || body.state === "failed") {
      return body;
    }
    await sleep(1000);
  }
  throw new Error(`job ${jobId} did not finish`);
}

async function readSseUntilTerminal(jobId, timeoutMs = 600_000) {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const response = await fetch(`${origin}/api/jobs/${jobId}/events`, { signal: controller.signal });
  assert(response.ok, "SSE stream failed to open");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes('"state":"succeeded"') || buffer.includes('"state":"failed"')) {
      controller.abort();
      return;
    }
  }
  throw new Error("SSE did not reach a terminal state");
}

async function runHappyPath(scratch) {
  const stack = startStack(scratch, {
    REPOHIVE_QUOTA_ACCOUNT_DAY: "5",
    REPOHIVE_QUOTA_IP_DAY: "10",
    REPOHIVE_QUOTA_PRECHECK_ACCOUNT_HOUR: "20",
    REPOHIVE_QUOTA_PRECHECK_IP_HOUR: "40",
  });
  try {
    await waitForHealth();
    const signUp = await jsonPost("/api/auth/sign-up", {
      email: email("e2e-main"),
      password: "password-ten-chars",
    });
    assert(signUp.response.status === 201, "sign-up failed", {
      status: signUp.response.status,
      body: signUp.body,
    });
    let cookie = signUp.cookie;

    const signIn = await jsonPost("/api/auth/sign-in", {
      email: email("e2e-main"),
      password: "password-ten-chars",
    });
    assert(signIn.response.status === 200, "sign-in failed");
    cookie = signIn.cookie || cookie;

    const first = await jsonPost("/api/index", { repo: "local/sample-java-project" }, cookie);
    assert(first.response.status === 202, "expected accepted", {
      status: first.response.status,
      body: first.body,
    });
    assert(first.body.status === "accepted", "first index was not accepted");
    const jobId = first.body.jobId;
    await readSseUntilTerminal(jobId);
    const finished = await waitForJobTerminal(jobId, cookie);
    assert(finished.state === "succeeded", "job did not succeed");

    const cached = await jsonPost("/api/index", { repo: "local/sample-java-project" }, cookie);
    assert(cached.response.status === 200, "cache response status");
    assert(cached.body.status === "cached", "second index was not cached");

    const quota = await jsonGet("/api/quota", cookie);
    assert(quota.response.status === 200, "quota status");
    assert(typeof quota.body.remainingAccount === "number", "quota shape");
  } finally {
    stack.stop();
    await sleep(2000);
  }
}

async function runLimits(scratch) {
  const stack = startStack(scratch, {
    REPOHIVE_QUOTA_ACCOUNT_DAY: "5",
    REPOHIVE_QUOTA_IP_DAY: "10",
    REPOHIVE_QUOTA_PRECHECK_ACCOUNT_HOUR: "2",
    REPOHIVE_QUOTA_PRECHECK_IP_HOUR: "40",
  });
  try {
    await waitForHealth();
    const cookie = (await jsonPost("/api/auth/sign-up", { email: email("limits"), password: "password-ten-chars" }))
      .cookie;
    for (let i = 0; i < 3; i += 1) {
      const attempt = await jsonPost("/api/index", { repo: "local/sample-java-project" }, cookie);
      if (i < 2) {
        assert(attempt.response.status === 202 || attempt.response.status === 200, "precheck attempt");
      } else {
        assert(attempt.response.status === 429, "precheck hourly limit");
      }
    }

    // The account created above (`limits`) already used one of this IP's 3
    // daily sign-up slots. Create the lockout account next, using the second,
    // before the loop below spends the rest: a sign-up rejected by the IP
    // limit never creates an account, and sign-in against a missing account
    // only ever returns the generic 401, never a lockout.
    const lockEmail = email("lock");
    const lockCookie = (await jsonPost("/api/auth/sign-up", { email: lockEmail, password: "password-ten-chars" }))
      .cookie;

    for (let n = 0; n < 2; n += 1) {
      const su = await jsonPost("/api/auth/sign-up", {
        email: email(`signup-${n}`),
        password: "password-ten-chars",
      });
      if (n < 1) {
        assert(su.response.status === 201, "sign-up slot");
      } else {
        assert(su.response.status === 429, "sign-up ip limit");
      }
    }

    for (let i = 0; i < 6; i += 1) {
      const bad = await jsonPost("/api/auth/sign-in", { email: lockEmail, password: "wrong-password-10" });
      if (i < 5) {
        assert(bad.response.status === 401, "bad sign-in");
      } else {
        assert(bad.response.status === 429, "sign-in lockout");
      }
    }
    assert(lockCookie !== "", "lockout account cookie from sign-up");
  } finally {
    stack.stop();
    await sleep(2000);
  }
}

async function runRefund(scratch) {
  const stack = startStack(scratch, {
    REPOHIVE_LOCAL_JOB_INJECT_FAILURE: "system",
    REPOHIVE_QUOTA_ACCOUNT_DAY: "5",
    REPOHIVE_QUOTA_IP_DAY: "10",
  });
  try {
    await waitForHealth();
    const cookie = (await jsonPost("/api/auth/sign-up", { email: email("refund"), password: "password-ten-chars" }))
      .cookie;
    const before = await jsonGet("/api/quota", cookie);
    const accepted = await jsonPost("/api/index", { repo: "local/sample-java-project" }, cookie);
    assert(accepted.response.status === 202, "refund path accepted");
    const jobId = accepted.body.jobId;
    const terminal = await waitForJobTerminal(jobId, cookie);
    assert(terminal.state === "failed", "injected job should fail");
    await sleep(12_000);
    const after = await jsonGet("/api/quota", cookie);
    assert(after.body.remainingAccount >= before.body.remainingAccount, "charge should be refunded");
  } finally {
    stack.stop();
  }
}

const scratchRoot = mkdtempSync(path.join(tmpdir(), "repohive-hosting3-e2e-"));
try {
  console.log("e2e: happy path");
  await runHappyPath(path.join(scratchRoot, "happy"));
  console.log("e2e: limits");
  await runLimits(path.join(scratchRoot, "limits"));
  console.log("e2e: system-failure refund");
  await runRefund(path.join(scratchRoot, "refund"));
  console.log("e2e: all passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await sleep(2000);
  try {
    rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (cleanupError) {
    console.warn(`e2e scratch cleanup: ${cleanupError}`);
  }
}
if (process.exitCode !== undefined && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
