// Runs deploy/box/spa.caddy under a Caddy binary against the static export and checks the host mapping of
// packages/web/README.md ("Static export and host mapping") request by request: the file served, the status, the
// content type, Cache-Control and the three security headers. It starts its own Caddy on a throwaway port with only
// the mapping in its config (no TLS, no plugins), so any Caddy 2 binary works, the release bundle's included.
//
//   node deploy/scripts/check-spa-mapping.mjs <caddy binary> <web root: packages/web/out or the bundle's web/> [port]
//
// Exits non-zero if any request is not answered as the rules say.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [caddyBinary, webRootArg, portArg] = process.argv.slice(2);
if (caddyBinary === undefined || webRootArg === undefined) {
  process.stderr.write("usage: check-spa-mapping.mjs <caddy binary> <web root> [port]\n");
  process.exit(2);
}
const webRoot = resolve(webRootArg);
const port = Number(portArg ?? 18080);
const spaFile = join(dirname(fileURLToPath(import.meta.url)), "..", "box", "spa.caddy").replaceAll("\\", "/");

const work = mkdtempSync(join(tmpdir(), "repohive-spa-"));
const caddyfile = join(work, "Caddyfile");
writeFileSync(
  caddyfile,
  `{\n\tadmin off\n\tauto_https off\n}\n:${port} {\n\troute {\n\t\timport ${spaFile}\n\t}\n}\n`,
);

const caddy = spawn(caddyBinary, ["run", "--config", caddyfile, "--adapter", "caddyfile"], {
  env: { ...process.env, WEB_ROOT: webRoot.replaceAll("\\", "/") },
  stdio: ["ignore", "ignore", "pipe"],
});
let caddyLog = "";
caddy.stderr.on("data", (chunk) => {
  caddyLog += chunk;
});

const base = `http://127.0.0.1:${port}`;
const RSC = { RSC: "1" };

// [description, path, request headers, expected status, expected file under the web root, content type prefix, cache-control]
const NO_CACHE = "no-cache";
const table = [
  ["the dashboard", "/", {}, 200, "index.html", "text/html", NO_CACHE],
  ["the dashboard's payload", "/index.txt?_rsc=x", RSC, 200, "index.txt", "text/x-component", NO_CACHE],
  ["a payload request for /", "/?_rsc=x", RSC, 200, "index.txt", "text/x-component", NO_CACHE],
  ["index.txt without the header is the plain file", "/index.txt", {}, 200, "index.txt", "text/plain", NO_CACHE],
  ["a page", "/auth/sign-in", {}, 200, "auth/sign-in.html", "text/html", NO_CACHE],
  ["a page with a trailing slash", "/auth/sign-up/", {}, 200, "auth/sign-up.html", "text/html", NO_CACHE],
  ["the .html itself", "/auth/sign-in.html", {}, 200, "auth/sign-in.html", "text/html", NO_CACHE],
  ["a page's payload", "/auth/sign-in.txt?_rsc=x", RSC, 200, "auth/sign-in.txt", "text/x-component", NO_CACHE],
  ["a page's /index.txt payload", "/auth/sign-in/index.txt?_rsc=x", RSC, 200, "auth/sign-in.txt", "text/x-component", NO_CACHE],
  ["a repository, any case", "/repos/OwNer/Repo", {}, 200, "repos/_/_.html", "text/html", NO_CACHE],
  ["a repository that is not a name at all", "/repos/-/..x", {}, 200, "repos/_/_.html", "text/html", NO_CACHE],
  ["a repository with a trailing slash", "/repos/o/r/", {}, 200, "repos/_/_.html", "text/html", NO_CACHE],
  ["a repository named foo.txt is a page", "/repos/o/foo.txt", {}, 200, "repos/_/_.html", "text/html", NO_CACHE],
  ["the payload of a repository", "/repos/o/r.txt?_rsc=x", RSC, 200, "repos/_/_.txt", "text/x-component", NO_CACHE],
  ["the payload of a repository named foo.txt", "/repos/o/foo.txt.txt?_rsc=x", RSC, 200, "repos/_/_.txt", "text/x-component", NO_CACHE],
  ["a surface", "/repos/o/r/hierarchy", {}, 200, "repos/_/_/hierarchy.html", "text/html", NO_CACHE],
  ["a surface's payload", "/repos/o/r/hierarchy.txt?_rsc=x", RSC, 200, "repos/_/_/hierarchy.txt", "text/x-component", NO_CACHE],
  ["a payload told by the query alone", "/repos/o/r/hierarchy.txt?_rsc=x", {}, 200, "repos/_/_/hierarchy.txt", "text/x-component", NO_CACHE],
  ["a surface that does not exist", "/repos/o/r/bogus", {}, 404, "404.html", "text/html", NO_CACHE],
  ["a payload of a surface that does not exist", "/repos/o/r/bogus.txt?_rsc=x", RSC, 404, "404.html", "text/html", NO_CACHE],
  ["too many segments", "/repos/o/r/hierarchy/x", {}, 404, "404.html", "text/html", NO_CACHE],
  ["a job", "/jobs/0123abcd", {}, 200, "jobs/_.html", "text/html", NO_CACHE],
  ["a job's payload", "/jobs/0123abcd.txt?_rsc=x", RSC, 200, "jobs/_.txt", "text/x-component", NO_CACHE],
  ["a job path with a second segment", "/jobs/a/b", {}, 404, "404.html", "text/html", NO_CACHE],
  ["a directory is not a page", "/repos", {}, 404, "404.html", "text/html", NO_CACHE],
  ["an unknown path", "/no-such-page", {}, 404, "404.html", "text/html", NO_CACHE],
  ["an image", "/icon.png", {}, 200, "icon.png", "image/png", null],
];

// A hashed asset, found in the export itself.
const staticDir = join(webRoot, "_next", "static", "chunks");
const chunk = readdirSync(staticDir).find((name) => name.endsWith(".js"));
if (chunk !== undefined) {
  table.push(["a hashed asset", `/_next/static/chunks/${chunk}`, {}, 200, `_next/static/chunks/${chunk}`, "text/javascript", "public, max-age=31536000, immutable"]);
}

const SECURITY = [
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["content-security-policy", "frame-ancestors 'none'"],
];

async function waitUp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (caddy.exitCode !== null) {
      throw new Error(`caddy exited with ${caddy.exitCode}:\n${caddyLog}`);
    }
    try {
      await fetch(`${base}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`caddy did not answer on ${base}:\n${caddyLog}`);
}

let failures = 0;
const fail = (what, why) => {
  failures += 1;
  process.stdout.write(`FAIL  ${what}: ${why}\n`);
};

try {
  await waitUp();
  for (const [what, path, headers, status, file, type, cache] of table) {
    const response = await fetch(base + path, { headers, redirect: "manual" });
    const body = Buffer.from(await response.arrayBuffer());
    const expected = readFileSync(join(webRoot, file));
    const problems = [];
    if (response.status !== status) problems.push(`status ${response.status}, expected ${status}`);
    if (!body.equals(expected)) problems.push(`served ${body.length} bytes, not ${file} (${expected.length} bytes)`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith(type)) problems.push(`content type ${contentType}, expected ${type}`);
    const cacheControl = response.headers.get("cache-control");
    if (cacheControl !== cache) problems.push(`cache-control ${cacheControl}, expected ${cache}`);
    for (const [name, value] of SECURITY) {
      if (response.headers.get(name) !== value) problems.push(`${name} is ${response.headers.get(name)}`);
    }
    if (problems.length > 0) fail(`${what} (${path})`, problems.join("; "));
    else process.stdout.write(`ok    ${what} (${path})\n`);
  }

  // A path that climbs out of the root must never reach a file outside it.
  for (const path of ["/..%2f..%2fetc%2fpasswd", "/%2e%2e/%2e%2e/etc/passwd", "/_next/..%5c..%5cpackage.json"]) {
    const response = await fetch(base + path, { redirect: "manual" });
    const text = await response.text();
    if (response.status === 200 && !text.includes("<html")) fail(`traversal ${path}`, `answered 200 with ${text.length} bytes`);
    else process.stdout.write(`ok    traversal ${path} (${response.status})\n`);
  }
} finally {
  caddy.kill();
  rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
  process.stdout.write(`\n${failures} request(s) not answered as the mapping says\n`);
  process.exit(1);
}
process.stdout.write("\nspa mapping: ok\n");
