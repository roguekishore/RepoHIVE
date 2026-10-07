import type { JobListItem } from "../../contracts";

export interface UsageDay {
  /** The UTC day of the month, 1 to 31. */
  readonly dayOfMonth: number;
  /** Jobs requested that day that did not fail: an index that fails does not count against the allowance. */
  readonly count: number;
  readonly today: boolean;
}

const DAY_MS = 86_400_000;

const utcDay = (time: number): number => Math.floor(time / DAY_MS);

/** The account's jobs per UTC day for the last `days` days, oldest first and ending today. A tally of recorded requests. */
export function usageByDay(items: readonly JobListItem[], now: Date, days = 14): UsageDay[] {
  const today = utcDay(now.getTime());
  const counts = new Map<number, number>();
  for (const job of items) {
    if (job.state === "failed") continue;
    const time = new Date(job.requestedAt).getTime();
    if (Number.isNaN(time)) continue;
    const day = utcDay(time);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, index) => {
    const day = today - (days - 1 - index);
    return { dayOfMonth: new Date(day * DAY_MS).getUTCDate(), count: counts.get(day) ?? 0, today: day === today };
  });
}
