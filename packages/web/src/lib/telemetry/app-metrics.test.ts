/**
 * hosting-3 Requirement 14: app embedded metrics in RepoHIVE/Hosted.
 */
import { describe, expect, it } from "vitest";
import { METRIC_NAMESPACE } from "@repohive/indexer";
import { getAppTelemetry } from "./app-metrics";

describe("app telemetry", () => {
  it("emits the intake and sign-up metrics without repository or account dimensions", () => {
    const lines: string[] = [];
    const telemetry = getAppTelemetry({ write: (line) => lines.push(line), now: () => 1_700_000_000_000 });
    telemetry.jobsAccepted();
    telemetry.jobsCacheHit();
    telemetry.jobsJoined();
    telemetry.jobsRejected("PRIVATE");
    telemetry.signUp();
    telemetry.inFlight(2);

    expect(lines).toHaveLength(6);
    for (const line of lines) {
      const parsed = JSON.parse(line) as {
        _aws: { CloudWatchMetrics: { Namespace: string; Dimensions: string[][] }[] };
        Component: string;
        Reason?: string;
      };
      expect(parsed._aws.CloudWatchMetrics[0]?.Namespace).toBe(METRIC_NAMESPACE);
      expect(parsed.Component).toBe("app");
      const dimensions = parsed._aws.CloudWatchMetrics[0]?.Dimensions[0] ?? [];
      expect(dimensions.every((name) => name === "Component" || name === "Reason")).toBe(true);
      expect(JSON.stringify(parsed)).not.toMatch(/github\.com|@[a-z0-9.-]+\.[a-z]/i);
    }
    const rejected = JSON.parse(lines[3]!) as { Reason: string; JobsRejected: number };
    expect(rejected.Reason).toBe("PRIVATE");
    expect(rejected.JobsRejected).toBe(1);
  });
});
