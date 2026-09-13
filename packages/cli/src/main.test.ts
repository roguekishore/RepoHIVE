/**
 * Tests for dispatch, the global flags, and the shape of a usage failure.
 *
 * The exit-code contract is what CI will be written against, so each code is
 * asserted at the boundary that produces it rather than inferred.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { main, readVersion, VIEW_DEFERRED_MESSAGE } from "./main.js";

/** Collect CLI output instead of writing to the console. */
export function captureIo(): {
  io: { log(m: string): void; error(m: string): void };
  out: string[];
  errs: string[];
} {
  const out: string[] = [];
  const errs: string[] = [];
  return { io: { log: (m) => out.push(m), error: (m) => errs.push(m) }, out, errs };
}

/** Assert that stdout held exactly one JSON document, and return it. */
export function soleJsonDocument(out: readonly string[]): Record<string, unknown> {
  assert.equal(out.length, 1, `expected one stdout document, got ${out.length}`);
  const parsed: unknown = JSON.parse(out[0]!);
  assert.ok(typeof parsed === "object" && parsed !== null);
  return parsed as Record<string, unknown>;
}

test("--version prints the version from the package manifest", async () => {
  const { io, out } = captureIo();
  assert.equal(await main(["--version"], io), 0);
  assert.deepEqual(out, [readVersion()]);
  assert.match(out[0]!, /^\d+\.\d+\.\d+/);
});

test("--help prints usage, names view as unshipped, and exits zero", async () => {
  for (const flag of ["--help", "-h"]) {
    const { io, out, errs } = captureIo();
    assert.equal(await main([flag], io), 0, flag);
    const text = out.join("\n");
    assert.ok(text.includes("usage: repohive <command>"), text);
    assert.ok(text.includes("not in this release"), text);
    assert.equal(errs.length, 0, "help is a result, so it goes to stdout");
  }
});

test("no arguments is a usage error with the usage text on stderr", async () => {
  const { io, out, errs } = captureIo();
  assert.equal(await main([], io), 2);
  assert.equal(out.length, 0, "an error is not a result");
  assert.ok(errs.some((line) => line.includes("a command is required")));
  assert.ok(errs.some((line) => line.includes("usage: repohive")));
});

test("an unknown command or global option exits 2 and names the token", async () => {
  for (const [argv, needle] of [
    [["describe"], "unknown command: describe"],
    [["--bogus"], "unknown option: --bogus"],
  ] as const) {
    const { io, errs } = captureIo();
    assert.equal(await main(argv, io), 2, argv.join(" "));
    assert.ok(errs.some((line) => line.includes(needle)), errs.join("\n"));
  }
});

test("view is recognized and reported as unshipped, not as unknown", async () => {
  const { io, errs } = captureIo();
  assert.equal(await main(["view"], io), 2);
  // The reported message, not the usage text that follows it (which lists
  // "unknown command" among the causes of exit 2).
  assert.ok(errs[0]?.includes(VIEW_DEFERRED_MESSAGE), errs.join("\n"));
  assert.ok(
    !errs[0]?.includes("unknown command"),
    "the name is decided, only the feature is deferred",
  );
});

test("--json turns a usage error into one document on stdout and nothing on stderr", async () => {
  const { io, out, errs } = captureIo();
  assert.equal(await main(["--json", "--bogus"], io), 2);
  assert.equal(errs.length, 0, "a --json run writes only to stdout");
  const document = soleJsonDocument(out);
  assert.equal(document["schemaVersion"], 1);
  assert.equal(document["ok"], false);
  assert.equal(document["stage"], "usage");
  assert.equal(document["command"], null, "no command was recognized");
  assert.match(String(document["message"]), /unknown option/);
});

test("a usage failure names the command when one was recognized", async () => {
  const { io, out } = captureIo();
  assert.equal(await main(["view", "--json"], io), 2);
  const document = soleJsonDocument(out);
  assert.equal(document["command"], "view");
  assert.equal(document["stage"], "usage");
});
