import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AdaptivityComparison,
  type AdaptivityRepoView,
} from "../../src/repohive/adaptivity-comparison";

/**
 * The figures below are the real measured outputs of this machine's fixtures
 * (2026-08-30), so a regression in the assessed-only arithmetic fails against
 * data a reader could check rather than against invented numbers.
 *
 *   broadleaf  502 regions · 216 degenerate · 286 assessed ·  38 preserved → 13%
 *   jsoup        8 regions ·   1 degenerate ·   7 assessed ·   3 preserved → 43%
 *   sample       4 regions ·   3 degenerate ·   1 assessed ·   0 preserved →  0%
 */

const CONFIG: AdaptivityRepoView["config"] = {
  boundary: 0.5,
  weights: { cohesion: 0.4, coupling: 0.4 },
  squashK: 1,
  seed: 42,
  maxGroupSize: 20,
  minPartitionThreshold: 2,
};

function repo(partial: Partial<AdaptivityRepoView> & { id: string }): AdaptivityRepoView {
  const assessed = partial.assessed ?? 0;
  const preserved = partial.preserved ?? 0;
  return {
    name: partial.id,
    files: 10,
    nodes: 100,
    edges: 50,
    depth: 4,
    regions: assessed + (partial.degenerate ?? 0),
    assessed,
    preserved,
    reconstructed: assessed - preserved,
    degenerate: partial.degenerate ?? 0,
    preserveShare: assessed === 0 ? null : preserved / assessed,
    config: CONFIG,
    assessedScores: [],
    ...partial,
  };
}

const BROADLEAF = repo({
  id: "broadleaf",
  files: 2985,
  nodes: 30889,
  edges: 23703,
  depth: 6,
  regions: 502,
  assessed: 286,
  preserved: 38,
  reconstructed: 248,
  degenerate: 216,
  preserveShare: 38 / 286,
  assessedScores: [0.06, 0.2, 0.45, 0.62, 0.71],
});

const JSOUP = repo({
  id: "jsoup",
  files: 95,
  nodes: 2583,
  edges: 560,
  depth: 4,
  regions: 8,
  assessed: 7,
  preserved: 3,
  reconstructed: 4,
  degenerate: 1,
  preserveShare: 3 / 7,
  assessedScores: [0.197, 0.203, 0.213, 0.478, 0.553, 0.554, 0.72],
});

describe("AdaptivityComparison — the assessed-only statistic", () => {
  it("reports each rate over assessed regions, never over the total", () => {
    render(<AdaptivityComparison repos={[BROADLEAF, JSOUP]} sameConfiguration />);
    // 38/286 = 13%, NOT 38/502 = 8%.
    expect(screen.getByText("13%")).toBeInTheDocument();
    expect(screen.getByText("(38 of 286)")).toBeInTheDocument();
    // 3/7 = 43%, NOT 3/8 = 38%.
    expect(screen.getByText("43%")).toBeInTheDocument();
    expect(screen.getByText("(3 of 7)")).toBeInTheDocument();
  });

  it("states the unassessed remainder rather than folding it into reconstruct", () => {
    render(<AdaptivityComparison repos={[BROADLEAF, JSOUP]} sameConfiguration />);
    expect(screen.getByText("216")).toBeInTheDocument();
    expect(
      screen.getAllByText(/below the measurable threshold and reconstructed by rule/i).length,
    ).toBe(2);
  });

  it("frames the spread as the adaptivity claim", () => {
    render(<AdaptivityComparison repos={[BROADLEAF, JSOUP]} sameConfiguration />);
    expect(screen.getByText(/13% to 43%/)).toBeInTheDocument();
    expect(screen.getByText(/30-point difference/)).toBeInTheDocument();
    expect(screen.getByText(/same algorithm on different code/i)).toBeInTheDocument();
  });

  it("shows the shared configuration that licenses the comparison", () => {
    render(<AdaptivityComparison repos={[BROADLEAF, JSOUP]} sameConfiguration />);
    const label = screen.getByText(/Identical across all runs/);
    // The value sits in the <dd> beside that <dt>; assert on it specifically so
    // the score-spread's own boundary caption cannot satisfy this test.
    const value = label.parentElement?.querySelector("dd");
    expect(value).toHaveTextContent("boundary 0.5");
    expect(value).toHaveTextContent("weights 0.4/0.4");
    expect(value).toHaveTextContent("seed 42");
  });
});

describe("AdaptivityComparison — refusing to overclaim", () => {
  it("replaces the claim with a caveat when the runs are not comparable", () => {
    render(
      <AdaptivityComparison
        repos={[BROADLEAF, { ...JSOUP, config: { ...CONFIG, boundary: 0.4 } }]}
        sameConfiguration={false}
        configurationNote="These runs do not share one configuration — boundary differ, so the comparison is not controlled."
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(/not controlled/);
    expect(screen.queryByText(/Identical across all runs/)).not.toBeInTheDocument();
  });

  it("declines to draw a comparison from a single repository", () => {
    render(<AdaptivityComparison repos={[JSOUP]} sameConfiguration />);
    expect(screen.getByText(/no comparison to draw yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/-point difference/)).not.toBeInTheDocument();
  });

  it("renders an all-degenerate repository as unmeasured, not as 0% preserved", () => {
    const allRule = repo({ id: "tiny", assessed: 0, preserved: 0, degenerate: 4, regions: 4 });
    render(<AdaptivityComparison repos={[allRule]} sameConfiguration />);
    expect(screen.getByText("—")).toBeInTheDocument(); // absent share, not "0%"
    expect(screen.getByText(/No region in this repository was large enough to assess/i)).toBeInTheDocument();
  });

  it("names registered repositories that have no index here", () => {
    render(<AdaptivityComparison repos={[JSOUP]} sameConfiguration skipped={["vantage"]} />);
    expect(screen.getByText(/Registered but not indexed on this machine/i)).toBeInTheDocument();
    expect(screen.getByText("vantage")).toBeInTheDocument();
  });

  it("says so when nothing at all is indexed", () => {
    render(<AdaptivityComparison repos={[]} sameConfiguration={false} />);
    expect(screen.getByText(/nothing to compare/i)).toBeInTheDocument();
  });
});
