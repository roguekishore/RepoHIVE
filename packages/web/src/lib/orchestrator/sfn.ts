/**
 * AWS Step Functions orchestrator, with an injectable client for tests.
 */
import { SFNClient, StartExecutionCommand, type SFNClientConfig } from "@aws-sdk/client-sfn";
import type { JobInput } from "@repohive/indexer";
import type { JobOrchestrator } from "./types";

export interface SfnOrchestratorOptions {
  readonly stateMachineArn: string;
  readonly region: string;
  readonly client?: SFNClient;
}

export function createSfnJobOrchestrator(options: SfnOrchestratorOptions): JobOrchestrator {
  const client =
    options.client ??
    new SFNClient({ region: options.region } satisfies SFNClientConfig);
  return {
    async start(input: JobInput): Promise<void> {
      await client.send(
        new StartExecutionCommand({
          stateMachineArn: options.stateMachineArn,
          input: JSON.stringify(input),
        }),
      );
    },
  };
}
