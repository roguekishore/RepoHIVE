import { describe, expect, it } from "vitest";
import type { JobListItem } from "../../contracts";
import { usageByDay } from "./usage";

const NOW = new Date("2026-10-07T10:00:00.000Z");

function job(requestedAt: string, state: JobListItem["state"] = "succeeded"): JobListItem {
  return { jobId: requestedAt, repo: "github.com/acme/widgets", state, tier: "S", requestedAt };
}

describe("usageByDay", () => {
  it("counts jobs per UTC day, oldest first, ending today", () => {
    const days = usageByDay([job("2026-10-07T01:00:00.000Z"), job("2026-10-07T23:59:00.000Z"), job("2026-10-06T12:00:00.000Z")], NOW);
    expect(days).toHaveLength(14);
    expect(days[13]).toEqual({ dayOfMonth: 7, count: 2, today: true });
    expect(days[12]).toEqual({ dayOfMonth: 6, count: 1, today: false });
    expect(days[0]?.dayOfMonth).toBe(24);
  });

  it("does not count a failed job, a job outside the window, or a date that does not parse", () => {
    const days = usageByDay([job("2026-10-07T01:00:00.000Z", "failed"), job("2026-09-01T00:00:00.000Z"), job("not a date")], NOW);
    expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(0);
  });
});
