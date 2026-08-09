/**
 * Unit tests for InputValidator (R1).
 *
 * Covers every validation branch (R1.1–R1.7). Existence / is-directory / happy
 * paths run against real temp directories; the permission-denied branches
 * (R1.6) are simulated with injected filesystem dependencies so the test is
 * robust on every platform, including Windows where POSIX `chmod` cannot
 * reliably remove read access.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  createInputValidator,
  validateInput,
  type DirLike,
  type StatLike,
  type ValidatorDeps,
} from "./input-validator.js";

/** Build an `Error` carrying a filesystem `code` (e.g. `EACCES`). */
function fsError(code: string): NodeJS.ErrnoException {
  const error = new Error(`simulated ${code}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

/** A `StatLike` reporting directory / non-directory. */
function statOf(isDir: boolean): StatLike {
  return { isDirectory: () => isDir };
}

/** A `DirLike` that reads no entries and closes cleanly. */
function emptyDir(): DirLike {
  return {
    read: async () => null,
    close: async () => undefined,
  };
}

/**
 * Build injectable {@link ValidatorDeps} from simple handlers, defaulting to
 * a readable, empty directory.
 */
function deps(overrides: Partial<ValidatorDeps> = {}): ValidatorDeps {
  return {
    stat: overrides.stat ?? (async () => statOf(true)),
    opendir: overrides.opendir ?? (async () => emptyDir()),
  };
}

describe("InputValidator — no path provided (R1.3)", () => {
  const cases: Array<[string, string | null | undefined]> = [
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace only", "   \t\n "],
  ];

  for (const [label, value] of cases) {
    test(`rejects ${label} with no-path-provided`, async () => {
      const result = await validateInput(value, deps());
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0]?.reason, "no-path-provided");
    });
  }

  test("does not touch the filesystem when no path is provided", async () => {
    let touched = false;
    const spyDeps = deps({
      stat: async () => {
        touched = true;
        return statOf(true);
      },
    });
    await validateInput("", spyDeps);
    assert.equal(touched, false, "stat must not run for empty input (R1.2)");
  });
});

describe("InputValidator — path not found (R1.4)", () => {
  test("rejects a missing path with path-not-found and includes the path", async () => {
    const missing = "does/not/exist/here";
    const result = await validateInput(
      missing,
      deps({
        stat: async () => {
          throw fsError("ENOENT");
        },
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.reason, "path-not-found");
    assert.equal(result.errors[0]?.path, missing);
  });
});

describe("InputValidator — path is not a directory (R1.5)", () => {
  test("rejects a file path with path-not-directory and includes the path", async () => {
    const filePath = "some/file.txt";
    const result = await validateInput(
      filePath,
      deps({
        stat: async () => statOf(false),
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.reason, "path-not-directory");
    assert.equal(result.errors[0]?.path, filePath);
  });
});

describe("InputValidator — directory unreadable (R1.6)", () => {
  test("EACCES from stat surfaces as directory-unreadable", async () => {
    const dirPath = "locked/dir";
    const result = await validateInput(
      dirPath,
      deps({
        stat: async () => {
          throw fsError("EACCES");
        },
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.reason, "directory-unreadable");
    assert.equal(result.errors[0]?.path, dirPath);
  });

  test("EACCES from opendir surfaces as directory-unreadable", async () => {
    const dirPath = "locked/dir";
    const result = await validateInput(
      dirPath,
      deps({
        stat: async () => statOf(true),
        opendir: async () => {
          throw fsError("EACCES");
        },
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.reason, "directory-unreadable");
    assert.equal(result.errors[0]?.path, dirPath);
  });

  test("EPERM from opendir surfaces as directory-unreadable", async () => {
    const result = await validateInput(
      "locked/dir",
      deps({
        opendir: async () => {
          throw fsError("EPERM");
        },
      }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors[0]?.reason, "directory-unreadable");
  });

  test("closes the directory handle even when read fails", async () => {
    let closed = false;
    const result = await validateInput(
      "dir",
      deps({
        opendir: async () => ({
          read: async () => {
            throw fsError("EACCES");
          },
          close: async () => {
            closed = true;
          },
        }),
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(closed, true, "dir.close() must run in a finally block");
  });
});

describe("InputValidator — accepts a valid directory (R1.1)", () => {
  test("returns ok with a resolved absolute path", async () => {
    const result = await validateInput("some/project", deps());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.absolutePath, path.resolve("some/project"));
  });

  test("completes stat before opendir (validation before collection, R1.2)", async () => {
    const calls: string[] = [];
    const result = await validateInput(
      "project",
      deps({
        stat: async () => {
          calls.push("stat");
          return statOf(true);
        },
        opendir: async () => {
          calls.push("opendir");
          return emptyDir();
        },
      }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ["stat", "opendir"]);
  });
});

describe("InputValidator — real filesystem integration", () => {
  let tmpRoot: string;

  before(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repohive-validator-"));
  });

  after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  test("accepts a real readable directory (R1.1)", async () => {
    const dir = path.join(tmpRoot, "project");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "A.java"), "class A {}");

    const result = await createInputValidator().validate(dir);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.absolutePath, path.resolve(dir));
  });

  test("rejects a real missing path with path-not-found (R1.4)", async () => {
    const missing = path.join(tmpRoot, "nope");
    const result = await createInputValidator().validate(missing);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors[0]?.reason, "path-not-found");
  });

  test("rejects a real file with path-not-directory (R1.5)", async () => {
    const filePath = path.join(tmpRoot, "file.txt");
    await fs.writeFile(filePath, "hello");
    const result = await createInputValidator().validate(filePath);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.errors[0]?.reason, "path-not-directory");
  });
});
