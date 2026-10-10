/**
 * How the views' recorded numbers are written. Fixed locale and time zone, so the same input prints the same text on
 * every machine.
 */
const COUNT = new Intl.NumberFormat("en-US");
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A whole number with thousands separators. */
export function formatCount(value: number): string {
  return COUNT.format(value);
}

/** A recorded score, cohesion or coupling, to three places. */
export function formatScore(value: number): string {
  return value.toFixed(3);
}

/** A recorded fraction as a percentage to one place; `null` (nothing was assessed) is a dash. */
export function formatShare(fraction: number | null): string {
  return fraction === null ? "—" : `${(fraction * 100).toFixed(1)}%`;
}

/** The recorded boundary as the engine's configuration prints it: two places at least, no padding beyond that. */
export function formatBoundary(value: number): string {
  return Number.isInteger(value * 100) ? value.toFixed(2) : String(value);
}

/** `4 Oct 2026` from an ISO-8601 time; the input text when it is not a date. */
export function formatDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : DATE.format(time);
}

/** The first eight characters of a snapshot id or the first seven of a commit, as the artifacts print them. */
export function shortId(id: string, length = 8): string {
  return id.slice(0, length);
}
