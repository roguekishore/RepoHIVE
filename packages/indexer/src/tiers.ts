/**
 * Tier caps (hosting-2 Glossary, Requirements 2.6 to 2.8 and 3.5). S and M run
 * on Lambda; L and XL share the large slot on Fargate.
 */
import type { Tier } from "./job-types.js";

/** Tiers, smallest first. */
export const TIER_ORDER: readonly Tier[] = ["S", "M", "L", "XL"];

/** Most selected Java files each tier takes. */
export const TIER_MAX_FILES: Readonly<Record<Tier, number>> = {
  S: 1_000,
  M: 5_000,
  L: 15_000,
  XL: 30_000,
};

/** The time limit each tier runs under, in milliseconds (hosting-4 "Tier timeouts"; hosting-2 Requirement 3.6). */
export const TIER_TIMEOUT_MS: Readonly<Record<Tier, number>> = {
  S: 300_000,
  M: 300_000,
  L: 600_000,
  XL: 900_000,
};

/** Most selected Java bytes any run takes: the XL cap. */
export const MAX_JAVA_BYTES = 250 * 1024 * 1024;

/** The smallest tier that fits `fileCount` files, or `undefined` past the XL cap. */
export function smallestTierForCount(fileCount: number): Tier | undefined {
  return TIER_ORDER.find((tier) => fileCount <= TIER_MAX_FILES[tier]);
}

/**
 * The smallest tier whose caps fit the files and bytes, or `undefined` when
 * either exceeds the XL cap. The byte cap is the XL cap and applies to every
 * tier, so a repository of up to 250 MB and 1,000 files is S.
 */
export function smallestTierFor(fileCount: number, javaBytes: number): Tier | undefined {
  return javaBytes > MAX_JAVA_BYTES ? undefined : smallestTierForCount(fileCount);
}
