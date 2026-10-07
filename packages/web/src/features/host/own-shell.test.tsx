import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignHost } from "./design-host";
import { OwnShell } from "./own-shell";

const navigation = vi.hoisted(() => ({ pathname: "/repos", push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

const SNAPSHOT = "0123456789abcdef0123456789abcdef";

const page = {
  items: [
    {
      repoKey: "github.com/acme/widgets",
      repoId: "acme/widgets",
      snapshotId: SNAPSHOT,
      commitSha: "c".repeat(40),
      indexedAt: "2026-10-07T00:00:00.000Z",
      nodeCount: 5,
    },
  ],
  page: 1,
  totalPages: 1,
  total: 1,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Stubs the browser's fetch with the answers a host gives; anything else fails the test. */
function serve(answers: Record<string, () => Response>) {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const answer = answers[url];
      if (answer === undefined) throw new Error(`unexpected request: ${url}`);
      return answer();
    }),
  );
  return asked;
}

const SIGNED_IN = {
  "/api/auth/session": () => json({ signedIn: true, email: "reader@example.com" }),
  "/api/quota": () => json({ remainingAccount: 3, remainingIp: 9, limitAccount: 5, limitIp: 10 }),
  "/api/repos": () => json(page),
};

function shell() {
  return render(
    <DesignHost>
      <OwnShell crumbs={[{ label: "Repositories" }]}>
        <p>the screen</p>
      </OwnShell>
    </DesignHost>,
  );
}

beforeEach(() => {
  navigation.pathname = "/repos";
  navigation.push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OwnShell", () => {
  it("frames the screen it is given, with its crumbs", async () => {
    serve(SIGNED_IN);
    shell();
    expect(screen.getByText("the screen")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Location" })).toHaveTextContent("Repositories");
    await screen.findByText("2 of 5 indexes today");
  });

  it("shows what was used today, from the server's allowance, once signed in", async () => {
    serve(SIGNED_IN);
    shell();
    expect(await screen.findByText("2 of 5 indexes today")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
  });

  it("offers sign-in, and does not ask for an allowance, when signed out", async () => {
    const asked = serve({
      "/api/auth/session": () => json({ signedIn: false }),
      "/api/repos": () => json(page),
    });
    shell();
    expect(await screen.findByText("Sign in to index a repository")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/sign-in");
    expect(asked).not.toContain("/api/quota");
  });

  it("still renders when the allowance cannot be read", async () => {
    serve({ ...SIGNED_IN, "/api/quota": () => json({ message: "down" }, 500) });
    shell();
    await screen.findByRole("link", { name: "Account" });
    expect(screen.getByText("the screen")).toBeInTheDocument();
    expect(screen.queryByText(/indexes today/)).not.toBeInTheDocument();
  });

  it("still renders when the repository list cannot be read", async () => {
    serve({ ...SIGNED_IN, "/api/repos": () => json({}, 500) });
    shell();
    await screen.findByText("2 of 5 indexes today");
    expect(screen.getByText("the screen")).toBeInTheDocument();
  });

  it("lists Activity: this host serves the account's job list", async () => {
    serve(SIGNED_IN);
    shell();
    await screen.findByText("2 of 5 indexes today");
    const global = screen.getByRole("navigation", { name: "Global" });
    expect(global).toHaveTextContent("Repositories");
    expect(global).toHaveTextContent("Method");
    expect(global).toHaveTextContent("Activity");
  });

  it("adds the repository's views to the sidebar inside a repository", async () => {
    navigation.pathname = "/repos/acme/widgets/hierarchy";
    serve(SIGNED_IN);
    shell();
    await screen.findByText("2 of 5 indexes today");
    const views = screen.getByRole("navigation", { name: "acme/widgets" });
    expect(screen.getByRole("link", { name: "Hierarchy" })).toHaveAttribute("aria-current", "page");
    expect(views).toHaveTextContent("Overview");
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("href", "/repos/acme/widgets/knowledge-graph");
  });

  it("searches the indexed repositories and goes there through the router", async () => {
    const asked = serve(SIGNED_IN);
    shell();
    await waitFor(() => expect(asked).toContain("/api/repos"));
    await screen.findByText("2 of 5 indexes today");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const box = await screen.findByRole("combobox");
    fireEvent.change(box, { target: { value: "widg" } });
    fireEvent.click(await screen.findByRole("option", { name: /acme\/widgets/ }));
    expect(navigation.push).toHaveBeenCalledWith("/repos/acme/widgets");
  });
});
