/**
 * One-command local stack (hosting-3 Requirement 15.1): Next.js server, the
 * background worker and the local orchestrator env, reading `config/local.env`
 * directly. The GitHub pre-check is stubbed to fixture tarballs when the app runs
 * in local mode.
 *
 *   npm run start-local --workspace @repohive/web [--port N] [--prod]
 *
 * By default the web server is `next dev`, so edits under `packages/web/src` rebuild
 * and refresh the browser with no build step. Pass `--prod` for the production
 * server instead; that needs `npm run build --workspace @repohive/web` first and
 * does not pick up edits.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalAppEnv, webRoot } from "./load-local-env.mjs";

const repoRoot = path.resolve(webRoot, "..", "..");
const port = process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1]
  : "3000";

const prod = process.argv.includes("--prod");

const baseEnv = loadLocalAppEnv(prod ? { PORT: port, NODE_ENV: "production" } : { PORT: port });

function npmScript(args, name) {
  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: repoRoot,
    env: { ...process.env, ...baseEnv },
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
  npmScript(["run", prod ? "start" : "dev", "--workspace", "@repohive/web", "--", "--port", port], "web"),
  npmScript(["run", "worker", "--workspace", "@repohive/web"], "worker"),
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
    origin: baseEnv.REPOHIVE_SITE_ORIGIN ?? `http://localhost:${port}`,
    port,
  }),
);
