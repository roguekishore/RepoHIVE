import { describe, expect, it } from "vitest";
import { jobIdFromPathname, repoKeyToViewerPath } from "./job-response";

describe("job page path", () => {
  it("reads the job id from the browser path", () => {
    expect(jobIdFromPathname("/jobs/abc")).toBe("abc");
    expect(jobIdFromPathname("/jobs/abc/")).toBe("abc");
    expect(jobIdFromPathname("/jobs/a%20b")).toBe("a b");
    expect(jobIdFromPathname("/jobs")).toBeUndefined();
    expect(jobIdFromPathname("/jobs/a/b")).toBeUndefined();
    expect(jobIdFromPathname("/")).toBeUndefined();
  });

  it("maps a repo key to its viewer path", () => {
    expect(repoKeyToViewerPath("github.com/acme/widgets")).toBe("/repos/acme/widgets/knowledge-graph");
    expect(repoKeyToViewerPath("acme/widgets")).toBeUndefined();
  });
});
