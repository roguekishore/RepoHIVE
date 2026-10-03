/** UTC calendar day `YYYY-MM-DD` (quota uses the same day boundary). */
export function utcCalendarDay(iso: string | Date = new Date()): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDaysIso(from: Date, days: number): string {
  const copy = new Date(from.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy.toISOString();
}

/** ISO timestamps at or after this instant (15-minute sign-in lockout window). */
export function isoSinceMinutes(minutes: number, from: Date = new Date()): string {
  return new Date(from.getTime() - minutes * 60_000).toISOString();
}

/** UTC hour bucket `YYYY-MM-DDTHH` for pre-check rate limits. */
export function utcHourBucket(iso: string | Date = new Date()): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return date.toISOString().slice(0, 13);
}
