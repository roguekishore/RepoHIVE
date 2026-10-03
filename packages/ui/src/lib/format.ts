/**
 * Number, date, token, and other formatters for repowise UI.
 */

/** Format a number with commas: 1234567 → "1,234,567" */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

/** Format large counts compactly: 1234567 → "1.2M", 98432 → "98.4K", 999 → "999" */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000) {
    const thousands = Number((n / 1_000).toFixed(1));
    return thousands === 1_000 ? "1M" : `${thousands}K`;
  }
  return String(n);
}

/** Format a datetime to a relative string: "2h ago", "3d ago", "just now" */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 5) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Relative time that tolerates null/invalid input, returning `fallback`
 *  (default "—"). The single null-safe wrapper used by the owner surfaces. */
export function formatRelativeTimeOrNull(
  iso: string | null | undefined,
  fallback = "—",
): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now()) return fallback;
  return formatRelativeTime(d);
}

/** Truncate a file path keeping as many trailing components as fit: src/very/long/path/file.py → …/long/path/file.py */
export function truncatePath(path: string, maxChars = 60): string {
  if (path.length <= maxChars) return path;
  const parts = path.split("/");
  if (parts.length <= 1) return `…${path.slice(-(maxChars - 1))}`;
  // Progressively include more trailing path components until we exceed maxChars
  for (let i = parts.length - 2; i >= 1; i--) {
    const candidate = `…/${parts.slice(i).join("/")}`;
    if (candidate.length <= maxChars) return candidate;
  }
  // Just filename
  const filename = parts[parts.length - 1] ?? path;
  return filename.length <= maxChars ? `…/${filename}` : `…${filename.slice(-(maxChars - 1))}`;
}

/** Format age in days to split units: 45 → "1 month 15 days", 400 → "1 year 1 month" */
export function formatAgeDays(n: number): string {
  if (n < 1) return "< 1 day";

  const days = Math.floor(n);
  const pluralize = (value: number, unit: string) =>
    `${value} ${unit}${value === 1 ? "" : "s"}`;

  if (days < 30) return pluralize(days, "day");
  if (days < 365) {
    const months = Math.floor(days / 30);
    const remainingDays = days % 30;
    return [pluralize(months, "month"), remainingDays && pluralize(remainingDays, "day")]
      .filter(Boolean)
      .join(" ");
  }

  let years = Math.floor(days / 365);
  let months = Math.floor((days % 365) / 30);
  if (months === 12) {
    years += 1;
    months = 0;
  }
  return [pluralize(years, "year"), months && pluralize(months, "month")]
    .filter(Boolean)
    .join(" ");
}

/** Format a confidence score as a percentage string: 0.87 → "87%" */
export function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/** Format a ratio as a percentage: 0.873 → "87%", 1 → "100%" */
export function formatPercent(ratio: number, decimals = 0): string {
  if (!Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  if (decimals <= 0) return `${Math.round(pct)}%`;
  return `${pct.toFixed(decimals)}%`;
}

/** Format byte counts: 1536 → "1.5 KB", 1048576 → "1.0 MB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const formatted = value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${units[exponent]}`;
}
