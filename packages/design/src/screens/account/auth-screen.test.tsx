import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "../../contracts";
import { renderWithDesign, stubClient } from "../../test-utils";
import { AuthScreen } from "./auth-screen";

const OK: ActionResult = { ok: true };

function setup(mode: "sign-in" | "sign-up", result: ActionResult | Error = OK) {
  const answer = (): Promise<ActionResult> => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result));
  const signIn = vi.fn(answer);
  const signUp = vi.fn(answer);
  const navigate = vi.fn();
  renderWithDesign(<AuthScreen mode={mode} />, { client: stubClient({ signIn, signUp }), navigate });
  return { signIn, signUp, navigate };
}

const email = (): HTMLElement => screen.getByLabelText("Email");
const password = (): HTMLElement => screen.getByLabelText("Password");

describe("AuthScreen", () => {
  it("names the page and offers the other form and the way home", () => {
    setup("sign-in");
    expect(screen.getByRole("heading", { name: "Sign in to RepoHIVE" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create one" })).toHaveAttribute("href", "/auth/sign-up");
    expect(screen.getByRole("link", { name: "RepoHIVE home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Back to the home page" })).toHaveAttribute("href", "/");
  });

  it("is the sign-up form on the other mode", () => {
    setup("sign-up");
    expect(screen.getByRole("heading", { name: "Create a RepoHIVE account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/sign-in");
    expect(screen.getByText("At least 10 characters.")).toBeInTheDocument();
    expect(password()).toHaveAttribute("autocomplete", "new-password");
  });

  it("explains an empty form on the email first, marks it invalid and focuses it", async () => {
    const { signIn } = setup("sign-in");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an email address, like name@example.com.");
    expect(email()).toHaveAttribute("aria-invalid", "true");
    expect(email()).toHaveFocus();
    expect(password()).not.toHaveAttribute("aria-invalid");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("asks for the password when only that is missing", async () => {
    setup("sign-in");
    await userEvent.type(email(), "me@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your password.");
    expect(password()).toHaveAttribute("aria-invalid", "true");
    expect(password()).toHaveFocus();
    expect(email()).not.toHaveAttribute("aria-invalid");
  });

  it("holds a new password to the length the servers require", async () => {
    const { signUp } = setup("sign-up");
    await userEvent.type(email(), "me@example.com");
    await userEvent.type(password(), "too short");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use at least 10 characters for the password.");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("signs in and goes to the repository list", async () => {
    const { signIn, signUp, navigate } = setup("sign-in");
    await userEvent.type(email(), "  me@example.com ");
    await userEvent.type(password(), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/repos"));
    expect(signIn).toHaveBeenCalledWith({ email: "me@example.com", password: "hunter2" });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("signs up with the sign-up action and goes to the repository list", async () => {
    const { signIn, signUp, navigate } = setup("sign-up");
    await userEvent.type(email(), "me@example.com");
    await userEvent.type(password(), "a long enough password");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/repos"));
    expect(signUp).toHaveBeenCalledWith({ email: "me@example.com", password: "a long enough password" });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("shows the server's message and stays on the page when the answer is a refusal", async () => {
    const { navigate } = setup("sign-in", { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Email or password is wrong." } });
    await userEvent.type(email(), "me@example.com");
    await userEvent.type(password(), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is wrong.");
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("says so when the request itself fails", async () => {
    const { navigate } = setup("sign-in", new Error("offline"));
    await userEvent.type(email(), "me@example.com");
    await userEvent.type(password(), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The request failed.");
    expect(navigate).not.toHaveBeenCalled();
  });
});
