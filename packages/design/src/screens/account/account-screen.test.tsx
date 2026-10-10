import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Quota } from "../../contracts";
import { renderWithDesign, stubClient } from "../../test-utils";
import { AccountScreen, SignOutButton, useAccountState } from "./account-screen";

const QUOTA: Quota = { remainingAccount: 3, remainingIp: 7, limitAccount: 5, limitIp: 20 };

function Probe() {
  const state = useAccountState();
  return <AccountScreen state={state} />;
}

describe("AccountScreen", () => {
  it("shows the email and each allowance as the endpoint returned it", () => {
    renderWithDesign(<AccountScreen state={{ status: "ready", email: "me@example.com", quota: QUOTA }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    const today = screen.getByRole("heading", { name: "Indexes today" }).closest("section")!;
    expect(within(today).getByText("2")).toBeInTheDocument();
    expect(within(today).getByText("of 5")).toBeInTheDocument();
    expect(within(today).getByRole("meter")).toHaveAttribute("aria-valuenow", "2");
    expect(within(today).getByRole("meter")).toHaveAttribute("aria-valuemax", "5");
    const network = screen.getByRole("heading", { name: "Indexes from this network" }).closest("section")!;
    expect(within(network).getByText("13")).toBeInTheDocument();
    expect(within(network).getByText("of 20")).toBeInTheDocument();
    expect(screen.getByText("5 a day")).toBeInTheDocument();
    expect(screen.getByText("20 a day")).toBeInTheDocument();
  });

  it("says the allowance could not be read instead of showing zeros", () => {
    renderWithDesign(<AccountScreen state={{ status: "ready", email: "me@example.com", quota: undefined }} />);
    expect(screen.getAllByText(/could not be read/)).toHaveLength(2);
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.queryByText(/a day/)).not.toBeInTheDocument();
  });

  it("offers sign in and sign up to a visitor who is signed out", () => {
    renderWithDesign(<AccountScreen state={{ status: "signed-out" }} />);
    expect(screen.getByText("You are not signed in")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/sign-in");
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/auth/sign-up");
  });

  it("announces loading and failure", () => {
    const { rerender } = renderWithDesign(<AccountScreen state={{ status: "loading" }} />);
    expect(screen.getByRole("status", { name: "Loading your account" })).toBeInTheDocument();
    rerender(<AccountScreen state={{ status: "failed" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Your account could not be loaded");
  });
});

describe("useAccountState", () => {
  it("reads the session and the allowance for a signed-in account", async () => {
    const quota = vi.fn(() => Promise.resolve(QUOTA));
    renderWithDesign(<Probe />, { client: stubClient({ session: () => Promise.resolve({ signedIn: true, email: "me@example.com" }), quota }) });
    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
    expect(quota).toHaveBeenCalledTimes(1);
  });

  it("does not ask for the allowance when signed out", async () => {
    const quota = vi.fn();
    renderWithDesign(<Probe />, { client: stubClient({ session: () => Promise.resolve({ signedIn: false }), quota }) });
    expect(await screen.findByText("You are not signed in")).toBeInTheDocument();
    expect(quota).not.toHaveBeenCalled();
  });

  it("keeps the page when only the allowance fails", async () => {
    renderWithDesign(<Probe />, {
      client: stubClient({ session: () => Promise.resolve({ signedIn: true, email: "me@example.com" }), quota: () => Promise.reject(new Error("x")) }),
    });
    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
    expect(screen.getAllByText(/could not be read/)).toHaveLength(2);
  });

  it("fails the page when the session cannot be read", async () => {
    renderWithDesign(<Probe />, { client: stubClient({ session: () => Promise.reject(new Error("x")) }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account could not be loaded");
  });
});

describe("SignOutButton", () => {
  it("ends the session and goes to the landing page", async () => {
    const signOut = vi.fn(() => Promise.resolve({ ok: true as const }));
    const navigate = vi.fn();
    renderWithDesign(<SignOutButton />, { client: stubClient({ signOut }), navigate });
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("stays put and says why when sign-out is refused", async () => {
    const navigate = vi.fn();
    const signOut = () => Promise.resolve({ ok: false as const, error: { code: "X", message: "Not allowed." } });
    renderWithDesign(<SignOutButton />, { client: stubClient({ signOut }), navigate });
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Not allowed.")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });
});
