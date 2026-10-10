/** Small formatters for the dashboard and Activity. Dates and times are the viewer's local ones. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const two = (n: number): string => String(n).padStart(2, "0");

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today", "Yesterday", or "4 Oct" (with the year when it is not this one). `undefined` for a date that does not parse. */
export function formatDay(iso: string, now: Date): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base} ${date.getFullYear()}`;
}

/** "Today 09:41", "Yesterday 18:02", "2 Oct 11:20". */
export function formatWhen(iso: string, now: Date): string {
  const day = formatDay(iso, now);
  if (day === undefined) return iso;
  const date = new Date(iso);
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** "1m 08s", "42s": the time between two recorded instants. `undefined` when either does not parse or the order is wrong. */
export function formatElapsed(fromIso: string, toIso: string): string | undefined {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return undefined;
  const seconds = Math.round((to - from) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${two(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${two(minutes % 60)}m`;
}

export const formatCount = (n: number): string => n.toLocaleString("en-US");

/** `REPO_TOO_LARGE` or `clone-timeout` as words: "Repo too large". A code is all the ledger keeps, so this is all there is. */
export function describeFailureCode(code: string): string {
  const words = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words === "" ? "Failed" : words.charAt(0).toUpperCase() + words.slice(1);
}

/** `github.com/owner/name` as `owner/name`. */
export function repoIdFromJobRepo(repo: string): string {
  return repo.replace(/^github\.com\//i, "").toLowerCase();
}
