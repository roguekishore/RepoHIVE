/**
 * The determinism demos' verdict, as a testable function (Fix 18 — Gap 18).
 *
 * The demo scripts computed their verdict as `digests.every(d => d === digests[0])`
 * — an absence-of-counterexample test, which an empty array satisfies. With
 * `runs = 0` the loop never executed and the script printed
 * `sha-256 : undefined` alongside `DETERMINISTIC`, exit 0. These scripts are
 * pointed at during reviews as evidence, so a false pass is an integrity
 * problem even though the underlying property holds.
 *
 * The verdict here is stated positively instead: the expected number of digests
 * were actually produced, each is a well-formed SHA-256, and they agree.
 */

/** A SHA-256 rendered as lowercase hex. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The smallest number of runs that can demonstrate anything.
 *
 * One run cannot: there is nothing to compare it against, so accepting
 * `runs = 1` would be as vacuous as accepting `runs = 0`.
 */
export const MIN_RUNS = 2;

export type RunsValidation =
  | { ok: true; runs: number }
  | { ok: false; message: string };

/** Validate the `runs` argument, which was previously used unchecked. */
export function validateRuns(raw: string | undefined, fallback = 3): RunsValidation {
  const runs = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(runs) || runs < MIN_RUNS) {
    return {
      ok: false,
      message: `runs must be an integer >= ${MIN_RUNS} (one run cannot demonstrate determinism), got ${JSON.stringify(raw)}`,
    };
  }
  return { ok: true, runs };
}

export interface DigestVerdict {
  deterministic: boolean;
  /** Why the verdict is negative; absent when it is positive. */
  reason?: string;
}

/**
 * Decide whether `digests` demonstrates determinism over `expectedRuns` runs.
 *
 * Positive on all three counts — right number of digests, each well-formed, all
 * equal — so an empty or short list can never pass.
 */
export function compareRunDigests(
  digests: readonly string[],
  expectedRuns: number
): DigestVerdict {
  if (expectedRuns < MIN_RUNS) {
    return { deterministic: false, reason: `fewer than ${MIN_RUNS} runs were requested` };
  }
  if (digests.length !== expectedRuns) {
    return {
      deterministic: false,
      reason: `expected ${expectedRuns} digests, got ${digests.length}`,
    };
  }
  const first = digests[0];
  if (first === undefined || !SHA256_HEX.test(first)) {
    return { deterministic: false, reason: `not a SHA-256 digest: ${JSON.stringify(first)}` };
  }
  for (const [index, digest] of digests.entries()) {
    if (!SHA256_HEX.test(digest)) {
      return { deterministic: false, reason: `run ${index + 1} produced a malformed digest` };
    }
    if (digest !== first) {
      return { deterministic: false, reason: `run ${index + 1} differs from run 1` };
    }
  }
  return { deterministic: true };
}
