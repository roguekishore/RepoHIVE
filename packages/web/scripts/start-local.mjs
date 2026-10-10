/**
 * The one command for local work: the Java server and the web dev server.
 *
 *   npm run start-local --workspace @repohive/web
 *
 * - `java -jar target/repohive-server.jar`, run from `<repo>/repohive-server`.
 *   The server reads `repohive-server/config/local.env` itself.
 * - `next dev --port 3000`, which proxies `/api`, `/artifacts` and `/healthz` to
 *   the server on port 8080 and maps the repository and job shells the way a
 *   production host does (see next.config.ts).
 *
 * Ctrl-C stops both. If the server jar is missing, build it first:
 *   (cd repohive-server && ./mvnw -q package -DskipTests)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const serverDir = path.join(repoRoot, "repohive-server");
const jar = path.join(serverDir, "target", "repohive-server.jar");

if (!existsSync(jar)) {
  console.error("build it first: (cd repohive-server && ./mvnw -q package -DskipTests)");
  process.exit(1);
}

const windows = process.platform === "win32";
let stopping = false;

function start(command, args, options) {
  const child = spawn(command, args, { stdio: "inherit", shell: windows && command !== "java", ...options });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    // One side ending takes the other down, so nothing is left running by accident.
    process.exitCode = code ?? (signal === null ? 0 : 1);
    shutdown();
  });
  return child;
}

const children = [
  start("java", ["-jar", path.join("target", "repohive-server.jar")], { cwd: serverDir }),
  start(windows ? "npx.cmd" : "npx", ["next", "dev", "--port", "3000"], { cwd: webRoot }),
];

function shutdown() {
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("RepoHIVE local: web http://localhost:3000, server http://127.0.0.1:8080 (Ctrl-C stops both)");
