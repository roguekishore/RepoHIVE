import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContractClient, Job, JobEvent } from "../../contracts";
import { renderWithDesign, stubClient } from "../../test-utils";
import { JobScreen, useJobState } from "./job-screen";

const SNAPSHOT = "2f866c4d558414aa1c8c5d794c8b9164";

function Page({ jobId }: { readonly jobId: string }) {
  const state = useJobState(jobId);
  return <JobScreen jobId={jobId} state={state} />;
}

function render(job: Job | undefined, overrides: Partial<ContractClient> = {}) {
  return renderWithDesign(<Page jobId="j_1" />, { client: stubClient({ job: () => Promise.resolve(job), watchJob: () => () => undefined, ...overrides }) });
}

describe("JobScreen", () => {
  it("shows a running job's stage and the count the ledger recorded", async () => {
    render({ repo: "github.com/acme/widgets", state: "parsing", progress: { stage: "parsing", completed: 4410, total: 7112 } });
    expect(await screen.findByRole("heading", { level: 1, name: "acme/widgets" })).toBeInTheDocument();
    expect(screen.getByText("4,410 / 7,112")).toBeInTheDocument();
    const current = screen.getByRole("listitem", { current: "step" });
    expect(within(current).getByText("Parsing source files")).toBeInTheDocument();
    expect(screen.getByText("A job finishes on its own. Leaving this page does not stop it.")).toBeInTheDocument();
  });

  it("marks every stage done and links the result once the job has succeeded", async () => {
    render({ repo: "github.com/acme/widgets", state: "succeeded", result: { snapshotId: SNAPSHOT } });
    expect(await screen.findByText("Succeeded", { selector: "span" })).toBeInTheDocument();
    expect(document.querySelectorAll(".rh-step-done")).toHaveLength(7);
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/repos/acme/widgets");
  });

  it("names the failure code and shows the stage the job stopped in", async () => {
    render({ repo: "github.com/acme/widgets", state: "failed", progress: { stage: "fetching" }, failure: { code: "clone-timeout", message: "Fetching took too long." } });
    expect(await screen.findByText("Fetching took too long.")).toBeInTheDocument();
    expect(screen.getByText("clone-timeout")).toBeInTheDocument();
    const stopped = document.querySelector(".rh-step-fail");
    expect(stopped).not.toBeNull();
    expect(within(stopped as HTMLElement).getByText("Failed")).toBeInTheDocument();
  });

  it("reads when the job was requested from the account's job list, and leaves the row out without it", async () => {
    const job: Job = { repo: "github.com/acme/widgets", state: "succeeded", result: { snapshotId: SNAPSHOT } };
    const item = { jobId: "j_1", repo: job.repo, state: job.state, tier: "S" as const, requestedAt: "2026-10-01T10:00:00.000Z", endedAt: "2026-10-01T10:01:08.000Z" };
    const { unmount } = render(job, { jobs: () => Promise.resolve({ items: [item] }) });
    expect(await screen.findByText("1m 08s")).toBeInTheDocument();
    expect(screen.getByText("Requested")).toBeInTheDocument();
    unmount();
    render(job);
    await screen.findByRole("heading", { level: 1, name: "acme/widgets" });
    expect(screen.queryByText("Requested")).toBeNull();
  });

  it("falls back to the failure code's words when no message was recorded", async () => {
    render({ repo: "github.com/acme/widgets", state: "failed", failure: { code: "clone-timeout" } });
    expect(await screen.findByText("Clone timeout")).toBeInTheDocument();
  });

  it("says so when the job does not exist", async () => {
    render(undefined);
    expect(await screen.findByText("There is no such job")).toBeInTheDocument();
  });

  it("says so when the job cannot be read", async () => {
    render(undefined, { job: () => Promise.reject(new Error("The job could not be loaded.")) });
    expect(await screen.findByText("The job could not be loaded.")).toBeInTheDocument();
  });

  it("follows a running job to its end and stops following when the page goes", async () => {
    const stop = vi.fn();
    let push: ((event: JobEvent) => void) | undefined;
    const { unmount } = render(
      { repo: "github.com/acme/widgets", state: "fetching" },
      {
        watchJob: (_id, onEvent) => {
          push = onEvent;
          return stop;
        },
      },
    );
    await screen.findByRole("heading", { level: 1, name: "acme/widgets" });
    await waitFor(() => expect(push).toBeDefined());
    push?.({ event: "done", data: { jobId: "j_1", repo: "github.com/acme/widgets", state: "succeeded", result: { snapshotId: SNAPSHOT } } });
    expect(await screen.findByRole("link", { name: "Open" })).toBeInTheDocument();
    unmount();
    expect(stop).toHaveBeenCalled();
  });
});
