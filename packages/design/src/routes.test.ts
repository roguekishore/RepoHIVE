import { describe, expect, it } from "vitest";
import { REPO_VIEWS, parseRepoPath, routes } from "./routes";

describe("routes", () => {
  it("is the approved route map", () => {
    expect(routes.landing).toBe("/");
    expect(routes.repos).toBe("/repos");
    expect(routes.signIn).toBe("/auth/sign-in");
    expect(routes.signUp).toBe("/auth/sign-up");
    expect(routes.account).toBe("/account");
    expect(routes.method).toBe("/method");
    expect(routes.activity).toBe("/activity");
    expect(routes.job("j_1")).toBe("/jobs/j_1");
    expect(routes.repo("apache", "kafka")).toBe("/repos/apache/kafka");
    expect(routes.repoView("apache", "kafka", "knowledge-graph")).toBe("/repos/apache/kafka/knowledge-graph");
  });

  it("keeps the older view paths and adds overview", () => {
    expect(REPO_VIEWS).toEqual([
      "overview",
      "knowledge-graph",
      "hierarchy",
      "decision-audit",
      "architecture",
      "flat-baseline",
      "adaptivity",
      "circles",
    ]);
  });

  it("encodes what a path cannot carry", () => {
    expect(routes.repo("a b", "c/d")).toBe("/repos/a%20b/c%2Fd");
    expect(routes.job("x y")).toBe("/jobs/x%20y");
  });
});

describe("parseRepoPath", () => {
  it("reads a repository and its view", () => {
    expect(parseRepoPath("/repos/apache/kafka/hierarchy")).toEqual({ owner: "apache", name: "kafka", view: "hierarchy" });
    expect(parseRepoPath("/repos/apache/kafka/")).toEqual({ owner: "apache", name: "kafka" });
    expect(parseRepoPath("/repos/apache/kafka")).toEqual({ owner: "apache", name: "kafka" });
  });

  it("round-trips every view", () => {
    for (const view of REPO_VIEWS) {
      expect(parseRepoPath(routes.repoView("o", "r", view))).toEqual({ owner: "o", name: "r", view });
    }
  });

  it("decodes names", () => {
    expect(parseRepoPath("/repos/a%20b/c%2Fd/map")).toEqual({ owner: "a b", name: "c/d" });
  });

  it("leaves an unknown view out, rather than inventing one", () => {
    expect(parseRepoPath("/repos/o/r/settings")).toEqual({ owner: "o", name: "r" });
  });

  it("answers undefined outside a repository", () => {
    for (const path of ["/", "/repos", "/repos/o", "/jobs/j_1", "/repos/o/r/hierarchy/extra", "/auth/sign-in"]) {
      expect(parseRepoPath(path), path).toBeUndefined();
    }
  });
});
