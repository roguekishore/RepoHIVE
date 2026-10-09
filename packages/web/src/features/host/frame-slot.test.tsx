import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignHost } from "./design-host";
import { OwnFrame, PageFrame, defaultCrumbs } from "./frame-slot";
import { RepositoryState, useRepository } from "./repository-state";

const navigation = vi.hoisted(() => ({ pathname: "/repos", search: "", push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

const SNAPSHOT = "0123456789abcdef0123456789abcdef";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Answers the frame's own reads (signed out, no repositories) and whatever else the test names. */
function serve(extra: Record<string, () => Response> = {}) {
  const answers: Record<string, () => Response> = {
    "/api/auth/session": () => json({ signedIn: false }),
    "/api/repos": () => json({ items: [], page: 1, totalPages: 1, total: 0 }),
    ...extra,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const answer = answers[String(input)];
      if (answer === undefined) throw new Error(`unexpected request: ${String(input)}`);
      return answer();
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigation.pathname = "/repos";
  navigation.search = "";
});

describe("defaultCrumbs", () => {
  it("names a global page", () => {
    expect(defaultCrumbs("/repos")).toEqual([{ label: "Repositories" }]);
    expect(defaultCrumbs("/method/")).toEqual([{ label: "Method" }]);
  });

  it("walks from Repositories to the view, using the navigation's word for the view", () => {
    expect(defaultCrumbs("/repos/acme/widgets/decision-audit")).toEqual([
      { label: "Repositories", href: "/repos" },
      { label: "acme/widgets", href: "/repos/acme/widgets" },
      { label: "Decisions" },
    ]);
  });

  it("has no crumbs for a path it does not know", () => {
    expect(defaultCrumbs("/jobs/abc")).toEqual([]);
  });
});

describe("OwnFrame and PageFrame", () => {
  it("shows the path's default crumbs, and a page's own while it is mounted", async () => {
    serve();
    navigation.pathname = "/repos/acme/widgets/overview";
    const { rerender } = render(
      <DesignHost>
        <OwnFrame>
          <PageFrame crumbs={[{ label: "Elsewhere" }]}>
            <p>screen</p>
          </PageFrame>
        </OwnFrame>
      </DesignHost>,
    );
    expect(await screen.findByText("Elsewhere")).toBeInTheDocument();
    rerender(
      <DesignHost>
        <OwnFrame>
          <p>screen</p>
        </OwnFrame>
      </DesignHost>,
    );
    await waitFor(() => expect(screen.queryByText("Elsewhere")).not.toBeInTheDocument());
    expect(screen.getAllByText("Overview").length).toBeGreaterThan(0);
  });
});

function Probe() {
  const { owner, name, snapshot } = useRepository();
  return (
    <p>
      {owner}/{name} {snapshot.status}
    </p>
  );
}

describe("RepositoryState", () => {
  it("is loading, then ready with the latest snapshot", async () => {
    serve({
      "/r/github.com/acme/widgets/latest.json": () =>
        json({ schemaVersion: 1, snapshotId: SNAPSHOT, commitSha: "c".repeat(40), repoKey: "github.com/acme/widgets" }),
    });
    render(
      <DesignHost>
        <RepositoryState owner="acme" name="widgets">
          <Probe />
        </RepositoryState>
      </DesignHost>,
    );
    expect(screen.getByText("acme/widgets loading")).toBeInTheDocument();
    expect(await screen.findByText("acme/widgets ready")).toBeInTheDocument();
  });

  it("is never-indexed when no pointer exists", async () => {
    serve({ "/r/github.com/acme/widgets/latest.json": () => new Response(null, { status: 404 }) });
    render(
      <DesignHost>
        <RepositoryState owner="acme" name="widgets">
          <Probe />
        </RepositoryState>
      </DesignHost>,
    );
    expect(await screen.findByText("acme/widgets never-indexed")).toBeInTheDocument();
  });

  it("refuses a screen mounted outside the repository layout", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/repository layout/);
  });
});
