// @vitest-environment node
import { REPO_VIEWS } from "@repohive/design";
import { describe, expect, it } from "vitest";
import { repoKeyToViewerPath } from "@/server/worker/repositories";
import { DEFAULT_REPO_VIEW } from "./default-view";

describe("the default repository view", () => {
  it("is a view the route map knows", () => {
    expect(REPO_VIEWS).toContain(DEFAULT_REPO_VIEW);
  });

  it("is where a finished job sends the user", () => {
    expect(repoKeyToViewerPath("github.com/acme/widgets")).toBe(`/repos/acme/widgets/${DEFAULT_REPO_VIEW}`);
  });

  it("sends a key that is not a GitHub repository nowhere", () => {
    expect(repoKeyToViewerPath("gitlab.com/acme/widgets")).toBeUndefined();
    expect(repoKeyToViewerPath("github.com/acme")).toBeUndefined();
    expect(repoKeyToViewerPath("")).toBeUndefined();
  });
});
