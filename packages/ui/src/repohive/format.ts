/**
 * Display formatting for engine values.
 *
 * The rule these functions exist to serve: a recorded value is never altered,
 * only *presented*. Rounding happens for display and never before a
 * comparison, and the exact recorded value stays reachable — as a `title`
 * attribute beside the rounded one, and rendered in full in the provenance
 * card.
 */

/** How many decimals tables and axis labels show. */
export const DISPLAY_DECIMALS = 3;

/**
 * A recorded number rounded for display, with trailing zeros trimmed.
 *
 * Use the exact value (`String(value)`) anywhere the number is the evidence —
 * the provenance card — and this anywhere a column of figures has to stay
 * readable. Always pair it with the exact value on hover.
 */
export function displayNumber(value: number, decimals: number = DISPLAY_DECIMALS): string {
  if (!Number.isFinite(value)) return String(value);
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "") || "0";
}

/** A share in [0,1] as whole percent. Returns "—" for an absent share. */
export function displayPercent(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

/**
 * Middle-elide a long identifier, keeping both ends.
 *
 * The distinguishing characters of the identifiers this product shows are at
 * the *end*: `g_002c619ae75eab55…` differs from its siblings only in the hash
 * tail, and `pkg:com.broadleafcommerce.core.catalog.domain` shares a long
 * prefix with dozens of others. Truncating the tail would throw away the only
 * part that identifies the thing, so both ends are kept and the middle goes.
 *
 * Pure and deterministic; the full value belongs in a `title` alongside.
 */
export function middleElide(value: string, max = 28): string {
  if (value.length <= max) return value;
  // Bias slightly toward the tail, which carries the distinguishing characters.
  const tail = Math.max(4, Math.floor((max - 1) / 2));
  const head = Math.max(1, max - 1 - tail);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/**
 * Elide a dotted package path from the left, keeping the last `segments`.
 *
 * `com.broadleafcommerce.core.catalog.domain` → `…core.catalog.domain`. The
 * leading segments are shared boilerplate; the trailing ones name the thing.
 */
export function elidePackage(path: string, segments = 3): string {
  const parts = path.split(".").filter(Boolean);
  if (parts.length <= segments) return path;
  return `…${parts.slice(parts.length - segments).join(".")}`;
}
