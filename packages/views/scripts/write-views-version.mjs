// Writes dist/views-version.json: { "viewsVersion": "<first 16 hex of SHA-256>" }.
// The hash covers every dist/**/*.js file in byte-wise path order, each as
// "<path>\n<content>\n", then the package's `dependencies` as canonical JSON
// (keys sorted byte-wise, no whitespace). Run after `tsc -b`.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(packageRoot, "dist");

function listJs(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...listJs(full));
    } else if (entry.name.endsWith(".js")) {
      found.push(full);
    }
  }
  return found;
}

const compareBytewise = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareBytewise)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const files = listJs(dist)
  .map((file) => ({ file, path: relative(dist, file).split(sep).join("/") }))
  .sort((a, b) => compareBytewise(a.path, b.path));

const hash = createHash("sha256");
for (const { file, path } of files) {
  hash.update(`${path}\n`, "utf8");
  hash.update(readFileSync(file));
  hash.update("\n", "utf8");
}
const { dependencies = {} } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
hash.update(canonical(dependencies), "utf8");

const viewsVersion = hash.digest("hex").slice(0, 16);
writeFileSync(join(dist, "views-version.json"), JSON.stringify({ viewsVersion }));
console.log(`views version ${viewsVersion} (${files.length} files)`);
