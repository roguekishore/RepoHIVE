import { describe, expect, it } from "vitest";
import { describeFailureCode, formatCount, formatDay, formatElapsed, formatWhen, repoIdFromJobRepo } from "./format";

const now = new Date(2026, 9, 7, 12, 0, 0);
const local = (month: number, day: number, hour = 9, minute = 41): string => new Date(2026, month, day, hour, minute).toISOString();

describe("dates", () => {
  it("say today, yesterday, or the day, with the year only when it is not this one", () => {
    expect(formatDay(local(9, 7), now)).toBe("Today");
    expect(formatDay(local(9, 6), now)).toBe("Yesterday");
    expect(formatDay(local(9, 4), now)).toBe("4 Oct");
    expect(formatDay(new Date(2025, 11, 31).toISOString(), now)).toBe("31 Dec 2025");
    expect(formatDay("not a date", now)).toBeUndefined();
  });

  it("add the local time", () => {
    expect(formatWhen(local(9, 7, 9, 5), now)).toBe("Today 09:05");
    expect(formatWhen("garbled", now)).toBe("garbled");
  });

  it("measure the time between two recorded instants", () => {
    expect(formatElapsed("2026-10-07T09:00:00.000Z", "2026-10-07T09:00:42.000Z")).toBe("42s");
    expect(formatElapsed("2026-10-07T09:00:00.000Z", "2026-10-07T09:01:08.000Z")).toBe("1m 08s");
    expect(formatElapsed("2026-10-07T09:00:00.000Z", "2026-10-07T11:05:00.000Z")).toBe("2h 05m");
    expect(formatElapsed("2026-10-07T09:00:00.000Z", "2026-10-07T08:00:00.000Z")).toBeUndefined();
    expect(formatElapsed("x", "2026-10-07T08:00:00.000Z")).toBeUndefined();
  });
});

describe("words", () => {
  it("put a failure code in words and never invent more", () => {
    expect(describeFailureCode("REPO_TOO_LARGE")).toBe("Repo too large");
    expect(describeFailureCode("clone-timeout")).toBe("Clone timeout");
    expect(describeFailureCode("")).toBe("Failed");
  });

  it("show a job repository and a count the way the lists do", () => {
    expect(repoIdFromJobRepo("github.com/Acme/Widgets")).toBe("acme/widgets");
    expect(formatCount(4182)).toBe("4,182");
  });
});
