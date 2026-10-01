import { getAppConfig } from "@/lib/hosting/config";
import { createLocalJobOrchestrator } from "./local";
import { createSfnJobOrchestrator } from "./sfn";
import type { JobOrchestrator } from "./types";

let cached: JobOrchestrator | undefined;

export function getJobOrchestrator(config = getAppConfig()): JobOrchestrator {
  if (cached === undefined) {
    cached =
      config.orchestrator.kind === "local"
        ? createLocalJobOrchestrator()
        : createSfnJobOrchestrator({
            stateMachineArn: config.orchestrator.stateMachineArn,
            region: config.awsRegion!,
          });
  }
  return cached;
}

export function resetJobOrchestratorForTests(orchestrator?: JobOrchestrator): void {
  cached = orchestrator;
}

export type { JobOrchestrator } from "./types";
