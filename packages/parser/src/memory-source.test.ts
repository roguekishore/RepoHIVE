/**
 * In-memory source and the shared selection policy (hosting-1 Requirement 5).
 *
 * The decisive property: the same tree, given once as a directory and once as
 * `{ path, bytes }` entries, produces a byte-identical `graph.json`.
 */

import assert from "node:assert/strict";
import * as nodeFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { createWorkerPoolPipeline } from "./extraction-pool.js";
import { createInputValidator } from "./input-validator.js";
import {
  decodeSourceBytes,
  findInvalidSourceEntry,
  selectMemorySource,
  type SourceEntry,
} from "./memory-source.js";
import { parseProject, type ParseDeps } from "./orchestrator.js";
import { createGraphSerializer } from "./serializer.js";
import { createSourceFileCollector } from "./source-collector.js";
import {
  DEFAULT_EXCLUDED_SEGMENTS,
  classifySourcePath,
  isSelectedSourcePath,
} from "./source-selection.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, "..", "..", "..", "fixtures", "sample-java-project");

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

let tmpRoot: string;

before(async () => {
  tmpRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), "repohive-memsrc-"));
});

after(async () => {
  await nodeFs.rm(tmpRoot, { recursive: true, force: true });
});

// --- The selection predicate --------------------------------------------------

test("isSelectedSourcePath applies the three rules: excluded directory, .java suffix, representability", () => {
  assert.equal(isSelectedSourcePath("src/main/A.java"), true);
  assert.equal(isSelectedSourcePath("A.java"), true);

  // Excluded directories, segment-exact and case-sensitive; the file name itself is never matched.
  assert.equal(isSelectedSourcePath("build/A.java"), false);
  assert.equal(isSelectedSourcePath("src/generated/A.java"), false);
  assert.equal(isSelectedSourcePath("Build/A.java"), true, "case-sensitive");
  assert.equal(isSelectedSourcePath("src/building/A.java"), true, "segment-exact");
  assert.equal(isSelectedSourcePath("src/build.java"), true, "a file named like an excluded segment is not excluded");

  // Case-sensitive .java.
  assert.equal(isSelectedSourcePath("src/A.JAVA"), false);
  assert.equal(isSelectedSourcePath("src/A.txt"), false);
  assert.equal(isSelectedSourcePath("src/Ajava"), false);

  // Cannot become a node id.
  assert.equal(isSelectedSourcePath("C:/x/A.java"), false);
  assert.equal(isSelectedSourcePath("src\\A.java"), false);
});

test("isSelectedSourcePath honours the exclusion option the engine takes", () => {
  assert.equal(isSelectedSourcePath("build/A.java", { excludedSegments: new Set() }), true, "empty set includes everything");
  assert.equal(isSelectedSourcePath("vendor/A.java", { excludedSegments: new Set(["vendor"]) }), false);
  assert.equal(isSelectedSourcePath("build/A.java", { excludedSegments: new Set(["vendor"]) }), true, "a custom set replaces the defaults");
});

test("classification order matches the walk: excluded beats everything, not-java beats representability", () => {
  const excluded = new Set(DEFAULT_EXCLUDED_SEGMENTS);
  assert.equal(classifySourcePath("build/we\\ird.java", excluded), "excluded");
  assert.equal(classifySourcePath("we\\ird.txt", excluded), "not-java");
  assert.equal(classifySourcePath("we\\ird.java", excluded), "unsupported");
});

// --- Entry validation ----------------------------------------------------------

test("findInvalidSourceEntry names the first problem in list order", () => {
  const ok: SourceEntry = { path: "src/A.java", bytes: enc("class A {}") };
  assert.equal(findInvalidSourceEntry([ok, { path: "src/B.java", bytes: enc("") }]), undefined);

  const cases: Array<[string, SourceEntry, RegExp]> = [
    ["absolute", { path: "/src/A.java", bytes: enc("") }, /absolute/],
    ["backslash", { path: "src\\A.java", bytes: enc("") }, /backslash/],
    ["dot-dot", { path: "src/../A.java", bytes: enc("") }, /"\.\."/],
    ["dot", { path: "./A.java", bytes: enc("") }, /"\."/],
    ["empty segment", { path: "src//A.java", bytes: enc("") }, /empty/],
    ["trailing slash", { path: "src/", bytes: enc("") }, /empty/],
    ["empty path", { path: "", bytes: enc("") }, /empty/],
    ["bytes not a Uint8Array", { path: "A.java", bytes: "class A {}" as unknown as Uint8Array }, /Uint8Array/],
    ["path not a string", { path: 7 as unknown as string, bytes: enc("") }, /string/],
  ];
  for (const [label, bad, expected] of cases) {
    const problem = findInvalidSourceEntry([ok, bad]);
    assert.ok(problem !== undefined, `${label} must be rejected`);
    assert.equal(problem.index, 1, label);
    assert.match(problem.problem, expected, label);
  }

  const duplicate = findInvalidSourceEntry([ok, { path: "src/A.java", bytes: enc("other") }]);
  assert.equal(duplicate?.index, 1);
  assert.match(duplicate?.problem ?? "", /duplicates/);
});

test("an entry the policy merely drops is a valid entry", () => {
  const entries: SourceEntry[] = [
    { path: "README.md", bytes: enc("hi") },
    { path: "build/Gen.java", bytes: enc("class Gen {}") },
    { path: "src/Upper.JAVA", bytes: enc("") },
  ];
  assert.equal(findInvalidSourceEntry(entries), undefined);
});

// --- Selection and decoding ----------------------------------------------------

test("selectMemorySource orders byte-wise, drops silently what the policy drops, and counts excluded directories", () => {
  const selection = selectMemorySource([
    { path: "z/Z.java", bytes: enc("class Z {}") },
    { path: "a/B.java", bytes: enc("class B {}") },
    { path: "a/b/C.java", bytes: enc("class C {}") },
    { path: "A.java", bytes: enc("class A {}") },
    { path: "build/G1.java", bytes: enc("") },
    { path: "build/inner/G2.java", bytes: enc("") },
    { path: "src/generated/G3.java", bytes: enc("") },
    { path: "notes.txt", bytes: enc("") },
  ]);
  // Byte-wise: "A.java" (0x41) before "a/..." (0x61); "a/B.java" before "a/b/C.java" ('B' 0x42 < 'b' 0x62).
  assert.deepEqual(
    selection.files.map((f) => f.relativePath),
    ["A.java", "a/B.java", "a/b/C.java", "z/Z.java"],
  );
  assert.deepEqual(selection.unsupported, []);
  assert.equal(selection.excludedDirectoryCount, 2, "build and src/generated, each once");
});

test("a .java path that cannot become a node id is reported like the disk walk reports it", () => {
  const selection = selectMemorySource([
    { path: "C:x/A.java", bytes: enc("") },
    { path: "src/Good.java", bytes: enc("") },
  ]);
  assert.deepEqual(selection.files.map((f) => f.relativePath), ["src/Good.java"]);
  assert.equal(selection.unsupported.length, 1);
  assert.equal(selection.unsupported[0]?.reason, "path-unsupported");
  assert.equal(selection.unsupported[0]?.path, "C:x/A.java");
});

test("decodeSourceBytes keeps a UTF-8 byte-order mark, as a file read does", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("class A {}")]);
  const decoded = decodeSourceBytes(bytes);
  assert.equal(decoded.charCodeAt(0), 0xfeff);

  const file = path.join(tmpRoot, "bom.java");
  await nodeFs.writeFile(file, bytes);
  assert.equal(decoded, await nodeFs.readFile(file, "utf8"), "identical to the disk decode");
});

test("decodeSourceBytes decodes a view into a larger buffer, and invalid UTF-8 the way a file read does", async () => {
  const backing = new Uint8Array([0, 0, ...enc("class É {}"), 0xc3, 0x28, 0, 0]);
  const view = backing.subarray(2, backing.length - 2);
  const file = path.join(tmpRoot, "invalid.java");
  await nodeFs.writeFile(file, view);
  assert.equal(decodeSourceBytes(view), await nodeFs.readFile(file, "utf8"));
});

// --- Directory versus memory ---------------------------------------------------

/** Every file under `root`, as memory entries, with POSIX paths: the non-Java files and excluded directories too. */
async function entriesOf(root: string): Promise<SourceEntry[]> {
  const entries: SourceEntry[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const dirent of await nodeFs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        await walk(full);
      } else if (dirent.isFile()) {
        entries.push({
          path: path.relative(root, full).split(path.sep).join("/"),
          bytes: new Uint8Array(await nodeFs.readFile(full)),
        });
      }
    }
  };
  await walk(root);
  return entries;
}

function realDeps(): ParseDeps {
  return {
    validator: createInputValidator(),
    collector: createSourceFileCollector(),
    pipeline: createWorkerPoolPipeline(),
    serializer: createGraphSerializer(),
  };
}

async function parseBoth(root: string): Promise<{ disk: Buffer; memory: Buffer }> {
  const diskOut = path.join(tmpRoot, `disk-${path.basename(root)}.json`);
  const memoryOut = path.join(tmpRoot, `memory-${path.basename(root)}.json`);
  const disk = await parseProject({ projectDirectory: root, outputPath: diskOut }, realDeps());
  assert.ok(disk.ok, `disk parse: ${JSON.stringify(disk)}`);
  const memory = await parseProject({ source: await entriesOf(root), outputPath: memoryOut }, realDeps());
  assert.ok(memory.ok, `memory parse: ${JSON.stringify(memory)}`);
  assert.equal(memory.value.nodeCount, disk.value.nodeCount);
  assert.equal(memory.value.edgeCount, disk.value.edgeCount);
  return { disk: await nodeFs.readFile(diskOut), memory: await nodeFs.readFile(memoryOut) };
}

test("sample-java-project: a memory source gives a byte-identical graph.json", async () => {
  const { disk, memory } = await parseBoth(FIXTURE_DIR);
  assert.ok(disk.equals(memory));
});

test("a tree with a byte-order mark, an excluded directory and non-Java files is byte-identical either way", async () => {
  const root = path.join(tmpRoot, "tree");
  await nodeFs.mkdir(path.join(root, "src", "com", "acme", "util"), { recursive: true });
  await nodeFs.mkdir(path.join(root, "build", "gen"), { recursive: true });
  await nodeFs.mkdir(path.join(root, "src", "Ünï"), { recursive: true });
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  await nodeFs.writeFile(
    path.join(root, "src", "com", "acme", "Main.java"),
    new Uint8Array([
      ...bom,
      ...enc("package com.acme;\nimport com.acme.util.Helper;\npublic class Main { void run() { new Helper().help(); } }\n"),
    ]),
  );
  await nodeFs.writeFile(
    path.join(root, "src", "com", "acme", "util", "Helper.java"),
    enc("package com.acme.util;\npublic class Helper { public void help() {} }\n"),
  );
  await nodeFs.writeFile(path.join(root, "src", "Ünï", "U.java"), enc("public class U {}\n"));
  await nodeFs.writeFile(path.join(root, "build", "gen", "Gen.java"), enc("class Gen {}\n"));
  await nodeFs.writeFile(path.join(root, "src", "Shout.JAVA"), enc("class Shout {}\n"));
  await nodeFs.writeFile(path.join(root, "README.md"), enc("# not java\n"));

  const { disk, memory } = await parseBoth(root);
  assert.ok(disk.equals(memory));
  const text = disk.toString("utf8");
  assert.ok(text.includes("Main.java") && text.includes("Helper"), "the fixture actually parsed");
  assert.ok(!text.includes("Gen.java") && !text.includes("Shout"), "excluded and non-Java files stayed out");
});

// --- Memory source never touches the disk --------------------------------------

test("a memory source reads no source file and walks no directory", async () => {
  const forbidden = (what: string) => () => {
    throw new Error(`${what} must not be used for a memory source`);
  };
  const deps: ParseDeps = {
    ...realDeps(),
    validator: { validate: forbidden("the validator") } as unknown as ParseDeps["validator"],
    collector: { collect: forbidden("the collector") } as unknown as ParseDeps["collector"],
    readBytes: forbidden("readBytes"),
    fileSize: forbidden("fileSize"),
  };
  const result = await parseProject(
    {
      source: [{ path: "A.java", bytes: enc("public class A {}\n") }],
      writeGraph: false,
    },
    deps,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.graph?.nodes.length, 2, "file node and class node");
});

// --- Failures ------------------------------------------------------------------

test("a malformed source list is a source-invalid error before any work", async () => {
  const result = await parseProject(
    { source: [{ path: "../A.java", bytes: enc("") }], writeGraph: false },
    realDeps(),
  );
  assert.ok(!result.ok);
  assert.equal(result.errors[0]?.reason, "source-invalid");
});

test("a memory source with nothing selected is no-java-files", async () => {
  const result = await parseProject(
    {
      source: [
        { path: "README.md", bytes: enc("") },
        { path: "build/A.java", bytes: enc("") },
      ],
      writeGraph: false,
    },
    realDeps(),
  );
  assert.ok(!result.ok);
  assert.equal(result.errors[0]?.reason, "no-java-files");
});

test("a memory source that writes the graph needs an output path", async () => {
  const result = await parseProject({ source: [{ path: "A.java", bytes: enc("class A {}") }] }, realDeps());
  assert.ok(!result.ok);
  assert.equal(result.errors[0]?.reason, "output-unwritable");
});

test("a file that cannot be parsed in a memory source is reported by path, in canonical order, and nothing is written", async () => {
  const out = path.join(tmpRoot, "never.json");
  const result = await parseProject(
    {
      source: [
        { path: "z/Bad2.java", bytes: enc("class {{{") },
        { path: "a/Bad1.java", bytes: enc("class {{{") },
        { path: "m/Good.java", bytes: enc("public class Good {}") },
      ],
      outputPath: out,
    },
    realDeps(),
  );
  assert.ok(!result.ok);
  assert.deepEqual(
    result.errors.map((e) => [e.reason, e.path]),
    [
      ["file-unparseable", "a/Bad1.java"],
      ["file-unparseable", "z/Bad2.java"],
    ],
  );
  await assert.rejects(() => nodeFs.readFile(out));
});
