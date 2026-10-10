import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignProvider, type ContractClient } from "@repohive/design";
import { RepositoryState } from "@/features/host/repository-state";
import { ViewPage } from "./view-page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

const SNAPSHOT = "0123456789abcdef0123456789abcdef";

function client(overrides: Partial<ContractClient>): ContractClient {
  const fail = () => Promise.reject(new Error("not expected"));
  return {
    session: fail,
    signIn: fail,
    signUp: fail,
    signOut: fail,
    quota: fail,
    requestIndex: fail,
    job: fail,
    watchJob: () => () => undefined,
    listRepositories: fail,
    repository: fail,
    snapshotPointer: () => Promise.resolve({ snapshotId: SNAPSHOT }),
    manifest: fail,
    view: fail as ContractClient["view"],
    architectureLevel: fail,
    regionDetailIndex: fail,
    regionDetail: fail,
    ...overrides,
  };
}

function page(stub: ContractClient) {
  return render(
    <DesignProvider client={stub}>
      <RepositoryState owner="acme" name="widgets">
        <ViewPage view="hierarchyScale" what="the hierarchy">
          {(data, repository) => <p>{`${repository.owner}/${repository.name}: ${data.totalFiles} files`}</p>}
        </ViewPage>
      </RepositoryState>
    </DesignProvider>,
  );
}

describe("ViewPage", () => {
  it("loads the snapshot, then the view body, and hands both to the screen", async () => {
    const view = vi.fn(() => Promise.resolve({ totalFiles: 12 }));
    page(client({ view: view as unknown as ContractClient["view"] }));
    expect(screen.getByText("Loading the hierarchy")).toBeInTheDocument();
    expect(await screen.findByText("acme/widgets: 12 files")).toBeInTheDocument();
    expect(view).toHaveBeenCalledWith(SNAPSHOT, "hierarchyScale");
  });

  it("says a repository that was never indexed has nothing to draw, and reads no view", async () => {
    const view = vi.fn();
    page(client({ snapshotPointer: () => Promise.resolve(undefined), view: view as unknown as ContractClient["view"] }));
    expect(await screen.findByText("This repository has not been indexed")).toBeInTheDocument();
    expect(view).not.toHaveBeenCalled();
  });

  it("shows why a snapshot could not be read", async () => {
    page(client({ snapshotPointer: () => Promise.reject(new Error("The index is unreachable.")) }));
    expect(await screen.findByText("Could not read this repository")).toBeInTheDocument();
    expect(screen.getByText("The index is unreachable.")).toBeInTheDocument();
  });

  it("shows why a view body could not be read", async () => {
    page(client({ view: (() => Promise.reject(new Error("This part of the snapshot is not published."))) as ContractClient["view"] }));
    await waitFor(() => expect(screen.getByText("Could not load the hierarchy")).toBeInTheDocument());
    expect(screen.getByText("This part of the snapshot is not published.")).toBeInTheDocument();
  });
});
