import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithDesign } from "../../test-utils";
import { ErrorScreen, LoadingScreen, NotFoundScreen } from "./status-screens";

describe("NotFoundScreen", () => {
  it("says there is no page and offers the landing page and the repositories from outside the app", () => {
    renderWithDesign(<NotFoundScreen />);
    expect(screen.getByRole("heading", { level: 1, name: "There is no page here." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home page" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Repositories" })).toHaveAttribute("href", "/repos");
  });

  it("sends home to the dashboard from inside the app", () => {
    renderWithDesign(<NotFoundScreen home="repos" />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/repos");
    expect(screen.queryByRole("link", { name: "Home page" })).toBeNull();
  });
});

describe("ErrorScreen", () => {
  it("announces what went wrong, shows the reference, and tries again on request", async () => {
    const reset = vi.fn();
    renderWithDesign(<ErrorScreen error={{ message: "The list could not be read.", digest: "abc123" }} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The list could not be read.");
    expect(screen.getByText("abc123")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Repositories" })).toHaveAttribute("href", "/repos");
  });

  it("falls back to a plain sentence when the error has no message", () => {
    renderWithDesign(<ErrorScreen error={{}} reset={() => undefined} />);
    expect(screen.getByText("An unexpected error occurred. Try again.")).toBeInTheDocument();
  });
});

describe("LoadingScreen", () => {
  it("names what is loading", () => {
    renderWithDesign(<LoadingScreen what="the repository" />);
    expect(screen.getByText("Loading the repository…")).toBeInTheDocument();
  });
});
