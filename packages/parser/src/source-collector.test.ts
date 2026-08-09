/**
 * Tests for SourceFileCollector (R2).
 *
 * Coverage:
 * - Unit (real filesystem): nested `.java` discovery, `.JAVA` case-sensitive
 *   exclusion, symlink skip (skips gracefully where symlinks can't be created),
 *   empty-project `no-java-files` error, canonical ordering.
 * - Unit (injected deps): fatal `directory-unreadable` on an unreadable
 *   subdirectory; symlinks are never followed.
 * - Property (fast-check): the collected result is independent of filesystem
 *   enumeration order (R2.6, R9.5).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import * as nodeFs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import fc from "fast-check";

import {
  collectSourceFiles,
  type CollectorDeps,
  type DirentLike,
} from "./source-collector.js";

// --------------------------------------------------------------------------
// In-memory filesystem for deterministic, OS-independent unit/property tests.
// --------------------------------------------------------------------------

type EntryType = "file" | "dir" | "symlink";

interface ModelEntry {
  name: string;
  type: EntryType;
}

/**
 * Build an in-memory directory model from a list of POSIX-relative paths.
 * `files` end in a leaf entry of the given `leafType`; intermediate segments
 * become directories. Returns a map from POSIX-relative directory path
 * (`""` = root) to its child entries.
 */
function buildModel(
  entries: { path: string; leafType: EntryType }[],
): Map<string, ModelEntry[]> {
  const dirs = new Map<string, Map<string, ModelEntry>>();
  const ensureDir = (rel: string): Map<string, ModelEntry> => {
    let d = dirs.get(rel);
    if (!d) {
      d = new Map();
      dirs.set(rel, d);
    }
    return d;
  };
  ensureDir("");

  for (const { path: rel, leafType } of entries) {
    const segments = rel.split("/").filter((s) => s.length > 0);
    let parent = "";
    for (let i = 0; i < segments.length; i++) {
      const name = segments[i]!;
      const isLeaf = i === segments.length - 1;
      const childRel = parent === "" ? name : `${parent}/${name}`;
      const type: EntryType = isLeaf ? leafType : "dir";
      const parentDir = ensureDir(parent);
      if (!parentDir.has(name)) {
        parentDir.set(name, { name, type });
      }
      if (type === "dir") {
        ensureDir(childRel);
      }
      parent = childRel;
    }
  }

  const result = new Map<string, ModelEntry[]>();
  for (const [rel, children] of dirs) {
    result.set(rel, [...children.values()]);
  }
  return result;
}

function makeDirent(entry: ModelEntry): DirentLike {
  return {
    name: entry.name,
    isDirectory: () => entry.type === "dir",
    isFile: () => entry.type === "file",
    isSymbolicLink: () => entry.type === "symlink",
  };
}

/**
 * Create injected {@link CollectorDeps} backed by an in-memory model rooted at
 * `base`. `order` transforms each directory's child list, letting tests vary
 * enumeration order without changing content.
 */
function memDeps(
  base: string,
  model: Map<string, ModelEntry[]>,
  order: (entries: ModelEntry[]) => ModelEntry[] = (e) => e,
): CollectorDeps {
  const toRel = (p: string): string =>
    path.relative(base, p).split(path.sep).join("/");
  return {
    async readdir(p) {
      const rel = toRel(p);
      const children = model.get(rel);
      if (!children) {
        const error = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return order(children).map(makeDirent);
    },
  };
}

const BASE = path.resolve(path.sep === "\\" ? "C:\\proj" : "/proj");

// --------------------------------------------------------------------------
// Real-filesystem unit tests.
// --------------------------------------------------------------------------

async function makeTempProject(): Promise<string> {
  return nodeFs.mkdtemp(path.join(os.tmpdir(), "repohive-collector-"));
}

test("discovers .java files nested at any depth", async () => {
  const root = await makeTempProject();
  try {
    await nodeFs.mkdir(path.join(root, "src", "com", "example"), {
      recursive: true,
    });
    await nodeFs.writeFile(path.join(root, "Top.java"), "class Top {}");
    await nodeFs.writeFile(
      path.join(root, "src", "A.java"),
      "class A {}",
    );
    await nodeFs.writeFile(
      path.join(root, "src", "com", "example", "Deep.java"),
      "class Deep {}",
    );

    const result = await collectSourceFiles({ absolutePath: root });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const relatives = result.value.map((f) => f.relativePath);
    assert.deepEqual(relatives, [
      "Top.java",
      "src/A.java",
      "src/com/example/Deep.java",
    ]);
    // Every relativePath uses forward slashes only.
    for (const rel of relatives) {
      assert.equal(rel.includes("\\"), false);
    }
  } finally {
    await nodeFs.rm(root, { recursive: true, force: true });
  }
});

test("excludes non-.java files and .JAVA (case-sensitive)", async () => {
  const root = await makeTempProject();
  try {
    await nodeFs.writeFile(path.join(root, "Keep.java"), "class Keep {}");
    await nodeFs.writeFile(path.join(root, "Skip.JAVA"), "class Skip {}");
    await nodeFs.writeFile(path.join(root, "readme.txt"), "notes");
    await nodeFs.writeFile(path.join(root, "Config.java.bak"), "x");

    const result = await collectSourceFiles({ absolutePath: root });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(
      result.value.map((f) => f.relativePath),
      ["Keep.java"],
    );
  } finally {
    await nodeFs.rm(root, { recursive: true, force: true });
  }
});

test("returns no-java-files error for an empty (but readable) project", async () => {
  const root = await makeTempProject();
  try {
    await nodeFs.mkdir(path.join(root, "docs"), { recursive: true });
    await nodeFs.writeFile(path.join(root, "docs", "notes.md"), "# notes");

    const result = await collectSourceFiles({ absolutePath: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]!.reason, "no-java-files");
    assert.equal(result.errors[0]!.path, root);
  } finally {
    await nodeFs.rm(root, { recursive: true, force: true });
  }
});

test("skips symbolic links and does not follow them", async () => {
  const root = await makeTempProject();
  try {
    await nodeFs.writeFile(path.join(root, "Real.java"), "class Real {}");
    const outside = await makeTempProject();
    try {
      await nodeFs.writeFile(
        path.join(outside, "Outside.java"),
        "class Outside {}",
      );

      // Symlink creation may require privileges on Windows; skip gracefully.
      let symlinksSupported = true;
      try {
        await nodeFs.symlink(
          path.join(outside, "Outside.java"),
          path.join(root, "LinkedFile.java"),
          "file",
        );
        await nodeFs.symlink(outside, path.join(root, "linkedDir"), "dir");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
          symlinksSupported = false;
        } else {
          throw error;
        }
      }

      if (!symlinksSupported) {
        return; // Environment can't create symlinks; nothing to assert.
      }

      const result = await collectSourceFiles({ absolutePath: root });
      assert.equal(result.ok, true);
      if (!result.ok) return;

      // Only the real file is collected; the symlinked file and the contents
      // reachable through the symlinked directory are not.
      assert.deepEqual(
        result.value.map((f) => f.relativePath),
        ["Real.java"],
      );
    } finally {
      await nodeFs.rm(outside, { recursive: true, force: true });
    }
  } finally {
    await nodeFs.rm(root, { recursive: true, force: true });
  }
});

// --------------------------------------------------------------------------
// Injected-deps unit tests (deterministic on every platform).
// --------------------------------------------------------------------------

test("returns directory-unreadable when a subdirectory cannot be read", async () => {
  const model = buildModel([
    { path: "src/A.java", leafType: "file" },
    { path: "locked", leafType: "dir" },
  ]);
  const lockedAbs = path.join(BASE, "locked");
  const deps: CollectorDeps = {
    async readdir(p) {
      if (p === lockedAbs) {
        const error = new Error("EACCES") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      const base = memDeps(BASE, model);
      return base.readdir(p);
    },
  };

  const result = await collectSourceFiles({ absolutePath: BASE }, deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.reason, "directory-unreadable");
  assert.equal(result.errors[0]!.path, lockedAbs);
});

test("does not follow symbolic links (injected deps)", async () => {
  // A symlink named like a directory and one named `.java`; neither is
  // traversed nor collected.
  const model = buildModel([
    { path: "Real.java", leafType: "file" },
    { path: "linkDir", leafType: "symlink" },
    { path: "Linked.java", leafType: "symlink" },
  ]);
  const result = await collectSourceFiles(
    { absolutePath: BASE },
    memDeps(BASE, model),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.map((f) => f.relativePath),
    ["Real.java"],
  );
});

// --------------------------------------------------------------------------
// Property: enumeration-order independence (R2.6, R9.5).
// --------------------------------------------------------------------------

test("collected result is independent of filesystem enumeration order", async () => {
  const segment = fc
    .string({ minLength: 1, maxLength: 4, unit: "grapheme-ascii" })
    .map((s) => s.replace(/[^a-zA-Z0-9]/g, "x"))
    .filter((s) => s.length > 0 && s !== "." && s !== "..");

  // A relative path of 1–3 directory segments plus a file leaf.
  const javaPath = fc
    .array(segment, { minLength: 0, maxLength: 3 })
    .chain((dirs) =>
      segment.map((leaf) => [...dirs, `${leaf}.java`].join("/")),
    );
  const otherPath = fc
    .array(segment, { minLength: 0, maxLength: 3 })
    .chain((dirs) =>
      segment.map((leaf) => [...dirs, `${leaf}.txt`].join("/")),
    );

  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(javaPath, { minLength: 1, maxLength: 12 }),
      fc.uniqueArray(otherPath, { minLength: 0, maxLength: 6 }),
      fc.integer(),
      async (javaPaths, otherPaths, seed) => {
        const model = buildModel([
          ...javaPaths.map((p) => ({ path: p, leafType: "file" as EntryType })),
          ...otherPaths.map((p) => ({
            path: p,
            leafType: "file" as EntryType,
          })),
        ]);

        // Run 1: natural enumeration order.
        const r1 = await collectSourceFiles(
          { absolutePath: BASE },
          memDeps(BASE, model),
        );
        // Run 2: reversed enumeration order in every directory.
        const r2 = await collectSourceFiles(
          { absolutePath: BASE },
          memDeps(BASE, model, (e) => [...e].reverse()),
        );
        // Run 3: seeded shuffle of every directory's entries.
        const shuffle = (entries: ModelEntry[]): ModelEntry[] => {
          const arr = [...entries];
          let s = seed >>> 0;
          for (let i = arr.length - 1; i > 0; i--) {
            s = (s * 1664525 + 1013904223) >>> 0;
            const j = s % (i + 1);
            [arr[i], arr[j]] = [arr[j]!, arr[i]!];
          }
          return arr;
        };
        const r3 = await collectSourceFiles(
          { absolutePath: BASE },
          memDeps(BASE, model, shuffle),
        );

        assert.equal(r1.ok, true);
        assert.equal(r2.ok, true);
        assert.equal(r3.ok, true);
        if (!r1.ok || !r2.ok || !r3.ok) return;

        const rel1 = r1.value.map((f) => f.relativePath);
        const rel2 = r2.value.map((f) => f.relativePath);
        const rel3 = r3.value.map((f) => f.relativePath);

        // Identical, and sorted byte-wise ascending.
        assert.deepEqual(rel1, rel2);
        assert.deepEqual(rel1, rel3);
        const sorted = [...rel1].sort((a, b) =>
          Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")),
        );
        assert.deepEqual(rel1, sorted);
      },
    ),
    { numRuns: 100 },
  );
});
