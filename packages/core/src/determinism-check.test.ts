/**
 * Tests for the determinism demos' verdict (Fix 18 — Gap 18).
 *
 * The scripts computed their verdict as `digests.every(d => d === digests[0])`,
 * which an empty array satisfies: `runs = 0` skipped the loop and the script
 * printed `sha-256 : undefined` alongside `DETERMINISTIC`, exit 0. The demo
 * guides present this output as review evidence, so a false pass is an
 * integrity problem even though the underlying property holds.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { compareRunDigests, MIN_RUNS, validateRuns } from "./determinism-check.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

test("validateRuns rejects everything that cannot demonstrate determinism", () => {
  for (const raw of ["0", "1", "-3", "2.5", "abc", "", "NaN", "Infinity"]) {
    const result = validateRuns(raw);
    assert.ok(!result.ok, `runs=${JSON.stringify(raw)} must be rejected`);
    assert.match(result.message, /integer >= 2/);
  }

  // One run is as vacuous as zero: there is nothing to compare it against.
  assert.equal(validateRuns("1").ok, false);
  assert.equal(MIN_RUNS, 2);
});

test("validateRuns accepts valid counts and the default", () => {
  for (const raw of ["2", "3", "10"]) {
    const result = validateRuns(raw);
    assert.ok(result.ok);
    assert.equal(result.runs, Number(raw));
  }

  const fallback = validateRuns(undefined);
  assert.ok(fallback.ok);
  assert.equal(fallback.runs, 3);
});

test("an empty or short digest list can never report determinism", () => {
  // The reproduced defect: zero runs, vacuously "identical".
  assert.equal(compareRunDigests([], 0).deterministic, false);
  assert.equal(compareRunDigests([], 3).deterministic, false);
  assert.equal(compareRunDigests([DIGEST_A], 1).deterministic, false);
  assert.equal(compareRunDigests([DIGEST_A, DIGEST_A], 3).deterministic, false);

  const short = compareRunDigests([DIGEST_A], 3);
  assert.match(short.reason ?? "", /expected 3 digests, got 1/);
});

test("identical well-formed digests over enough runs are deterministic", () => {
  assert.equal(compareRunDigests([DIGEST_A, DIGEST_A], 2).deterministic, true);
  assert.equal(compareRunDigests([DIGEST_A, DIGEST_A, DIGEST_A], 3).deterministic, true);
});

test("one differing digest is reported with the run that diverged", () => {
  const verdict = compareRunDigests([DIGEST_A, DIGEST_A, DIGEST_B], 3);
  assert.equal(verdict.deterministic, false);
  assert.match(verdict.reason ?? "", /run 3 differs/);
});

test("a malformed digest is rejected even when every run agrees", () => {
  // Agreement is not enough: `undefined` repeated would also "agree".
  for (const bad of ["", "not-a-digest", "A".repeat(64), "a".repeat(63)]) {
    const verdict = compareRunDigests([bad, bad], 2);
    assert.equal(verdict.deterministic, false, JSON.stringify(bad));
  }
});
