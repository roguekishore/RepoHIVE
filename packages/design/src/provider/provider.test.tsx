import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignProvider, useClient, useLink, useNavigate } from "./design-provider";
import { useToast } from "./toast";
import { THEME_STORAGE_KEY, applyTheme, themeInitScript, useTheme } from "../theme/theme";
import { TestLink, memoryStorage, renderWithDesign, stubClient } from "../test-utils";

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-theme");
});

describe("DesignProvider", () => {
  it("wraps the page in the scoped root", () => {
    const { container } = renderWithDesign(<p>hello</p>);
    expect(container.querySelector(".rh-root")).toContainElement(screen.getByText("hello"));
  });

  it("hands out the injected link, navigate and client", () => {
    const client = stubClient();
    const navigate = vi.fn();
    let seen: { link: unknown; navigate: unknown; client: unknown } | undefined;
    function Probe() {
      seen = { link: useLink(), navigate: useNavigate(), client: useClient() };
      return null;
    }
    render(
      <DesignProvider Link={TestLink} navigate={navigate} client={client}>
        <Probe />
      </DesignProvider>,
    );
    expect(seen).toEqual({ link: TestLink, navigate, client });
  });

  it("uses a plain anchor when the host injects no link", () => {
    function Probe() {
      const Link = useLink();
      return <Link href="/repos">Repos</Link>;
    }
    render(
      <DesignProvider>
        <Probe />
      </DesignProvider>,
    );
    expect(screen.getByRole("link", { name: "Repos" })).toHaveAttribute("href", "/repos");
  });

  it("says plainly when the client is missing", () => {
    function Probe() {
      useClient();
      return null;
    }
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      render(
        <DesignProvider>
          <Probe />
        </DesignProvider>,
      ),
    ).toThrow("DesignProvider was mounted without a client");
    quiet.mockRestore();
  });

  it("refuses hooks outside the provider", () => {
    function Probe() {
      useLink();
      return null;
    }
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow("inside a DesignProvider");
    quiet.mockRestore();
  });
});

describe("toast", () => {
  function Trigger({ message }: { message: string }) {
    const toast = useToast();
    return (
      <button type="button" onClick={() => toast(message)}>
        show
      </button>
    );
  }

  it("shows a message and removes it after the duration", () => {
    vi.useFakeTimers();
    renderWithDesign(<Trigger message="Indexing started" />);
    act(() => screen.getByRole("button", { name: "show" }).click());
    expect(screen.getByRole("status")).toHaveTextContent("Indexing started");
    act(() => {
      vi.advanceTimersByTime(2599);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Indexing started");
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("replaces the message and restarts the timer", () => {
    vi.useFakeTimers();
    function Two() {
      const toast = useToast();
      return (
        <>
          <button type="button" onClick={() => toast("first")}>
            one
          </button>
          <button type="button" onClick={() => toast("second")}>
            two
          </button>
        </>
      );
    }
    renderWithDesign(<Two />);
    act(() => screen.getByRole("button", { name: "one" }).click());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => screen.getByRole("button", { name: "two" }).click());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("second");
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("theme", () => {
  function ThemeProbe() {
    const { preference, setPreference } = useTheme();
    return (
      <>
        <span data-testid="pref">{preference}</span>
        <button type="button" onClick={() => setPreference("dark")}>
          dark
        </button>
        <button type="button" onClick={() => setPreference("system")}>
          system
        </button>
      </>
    );
  }

  it("starts as the system setting and applies a stored override once mounted", () => {
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: "dark" });
    render(
      <DesignProvider themeStorage={storage}>
        <ThemeProbe />
      </DesignProvider>,
    );
    expect(screen.getByTestId("pref")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("ignores a stored value it does not know", () => {
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: "sepia" });
    render(
      <DesignProvider themeStorage={storage}>
        <ThemeProbe />
      </DesignProvider>,
    );
    expect(screen.getByTestId("pref")).toHaveTextContent("system");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("applies and stores a choice, and clears the attribute for the system setting", async () => {
    const storage = memoryStorage();
    render(
      <DesignProvider themeStorage={storage}>
        <ThemeProbe />
      </DesignProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe("dark");
    await userEvent.click(screen.getByRole("button", { name: "system" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe("system");
  });

  it("still applies a choice when storage is blocked", async () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    render(
      <DesignProvider themeStorage={blocked}>
        <ThemeProbe />
      </DesignProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("applyTheme sets and clears the attribute", () => {
    applyTheme("light", document.documentElement);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    applyTheme("system", document.documentElement);
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("the init script applies a stored override before paint and nothing else", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(themeInitScript)();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    new Function(themeInitScript)();
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    localStorage.clear();
  });
});
