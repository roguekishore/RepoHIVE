/**
 * Tests for the failure renderers: one readable line per failure arm, with
 * group failures delegating to core's own `describeError` wording.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { describeEngineError, describeEngineFailure } from "./errors.js";

test("engine-level errors render with their code-specific wording", () => {
  assert.equal(
    describeEngineError({
      code: "INVALID_OPTIONS",
      field: "concurrency",
      detail: "concurrency: must be an integer >= 1 (got 0)",
    }),
    "invalid options: concurrency: must be an integer >= 1 (got 0)",
  );
  assert.equal(
    describeEngineError({
      code: "OUTPUT_DIRECTORY_UNWRITABLE",
      path: "/proj/.repohive",
      detail: "EACCES: permission denied",
    }),
    "could not prepare output directory /proj/.repohive: EACCES: permission denied",
  );
  assert.equal(
    describeEngineError({ code: "INTERNAL_ERROR", detail: "boom" }),
    "internal error: boom",
  );
});

test("an engine failure renders through describeEngineError", () => {
  assert.equal(
    describeEngineFailure({
      ok: false,
      stage: "engine",
      error: { code: "INTERNAL_ERROR", detail: "boom" },
    }),
    "internal error: boom",
  );
});

test("a parse failure renders the first error and counts the rest", () => {
  assert.equal(
    describeEngineFailure({
      ok: false,
      stage: "parse",
      errors: [{ reason: "path-not-found", message: "Path does not exist: /x", path: "/x" }],
    }),
    "parse failed: Path does not exist: /x",
  );
  assert.equal(
    describeEngineFailure({
      ok: false,
      stage: "parse",
      errors: [
        { reason: "file-unreadable", message: "Cannot read A.java", path: "A.java" },
        { reason: "file-unparseable", message: "Cannot parse B.java", path: "B.java" },
      ],
    }),
    "parse failed: Cannot read A.java (and 1 more error)",
  );
  assert.equal(
    describeEngineFailure({
      ok: false,
      stage: "parse",
      errors: [
        { reason: "file-unreadable", message: "Cannot read A.java", path: "A.java" },
        { reason: "file-unparseable", message: "Cannot parse B.java", path: "B.java" },
        { reason: "file-unparseable", message: "Cannot parse C.java", path: "C.java" },
      ],
    }),
    "parse failed: Cannot read A.java (and 2 more errors)",
  );
  // Defensive: an empty error list is not producible by the parser (a failed
  // Result always carries at least one error) but must still render.
  assert.equal(
    describeEngineFailure({ ok: false, stage: "parse", errors: [] }),
    "parse failed",
  );
});

test("a group failure renders through core's describeError wording", () => {
  assert.equal(
    describeEngineFailure({
      ok: false,
      stage: "group",
      error: { code: "FILE_NOT_FOUND", file: "/proj/.repohive/graph.json" },
      graphPath: "/proj/.repohive/graph.json",
    }),
    "group failed: file not found or unreadable: /proj/.repohive/graph.json",
  );
});
