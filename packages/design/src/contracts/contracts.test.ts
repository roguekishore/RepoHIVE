// @vitest-environment node
import { VIEW_FILES } from "@repohive/indexer";
import { describe, expect, it } from "vitest";
import { JOB_STATES, VIEW_NAMES, isTerminalJobState } from "./index";

describe("contract values", () => {
  it("names the views the indexer publishes, and only those", () => {
    for (const name of VIEW_NAMES) {
      expect(Object.keys(VIEW_FILES), name).toContain(name);
    }
    // The region detail index is read through its own client method, not as a view body.
    const published = Object.keys(VIEW_FILES).filter((name) => !(VIEW_NAMES as readonly string[]).includes(name));
    expect(published).toEqual(["regionDetailIndex"]);
  });

  it("lists the job states in the order a job passes through them", () => {
    expect(JOB_STATES).toEqual([
      "queued",
      "waiting-for-slot",
      "fetching",
      "parsing",
      "grouping",
      "building-views",
      "publishing",
      "succeeded",
      "failed",
    ]);
  });

  it("knows the two end states", () => {
    expect(JOB_STATES.filter(isTerminalJobState)).toEqual(["succeeded", "failed"]);
  });
});
