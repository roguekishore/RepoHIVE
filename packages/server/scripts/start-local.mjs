/**
 * One-command local stack: the API server (with its background worker) on one port and the Next.js web app on
 * another. The web dev server forwards `/api`, `/healthz`, `/r` and `/s` to the API server, so the browser sees
 * a single origin. Reads `config/local.env` directly. The GitHub pre-check is stubbed to fixture tarballs
 * when the server runs in local mode.
 *
 *   npm run start-local --workspace @repohive/server [--port N] [--api-port N] [--prod]
 *
 * By default the web server is `next dev`, so edits under `packages/web/src` rebuild and refresh the browser with
 * no build step. Pass `--prod` for the production web server instead; that needs
 * `npm run build --workspace @repohive/web` first and does not pick up edits.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { loadLocalAppEnv, serverRoot } from "./load-local-env.mjs";

const repoRoot = path.resolve(serverRoot, "..", "..");

function flag(name, fallback) {
  return process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
}

const port = flag("--port", "3000");
const apiPort = flag("--api-port", "3001");
const prod = process.argv.includes("--prod");

const baseEnv = loadLocalAppEnv({
  REPOHIVE_SITE_ORIGIN: `http://localhost:${port}`,
  ...(prod ? { NODE_ENV: "production" } : {}),
});

function npmScript(args, extraEnv) {
  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: repoRoot,
    env: { ...process.env, ...baseEnv, ...extraEnv },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
    } else if (code !== 0 && code !== null) {
      process.exitCode = code;
      shutdown();
    }
  });
  return child;
}

const children = [
  npmScript(["run", "start", "--workspace", "@repohive/server"], { PORT: apiPort }),
  npmScript(["run", prod ? "start" : "dev", "--workspace", "@repohive/web", "--", "--port", port], {
    REPOHIVE_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
  }),
];

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", shutdown);

console.log(
  JSON.stringify({
    level: "info",
    msg: "local stack running",
    origin: baseEnv.REPOHIVE_SITE_ORIGIN,
    port,
    apiPort,
  }),
);
