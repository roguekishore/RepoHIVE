/**
 * AWS Step Functions orchestrator (Requirement 8.6), with an injectable client for tests.
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
          // The execution is named after the job (hosting-4 Requirement 11.9): the state machine's
          // EventBridge backstop finds the job's ledger record by this name. A repeated name fails
          // the start rather than running the job twice.
          name: input.jobId,
          input: JSON.stringify(input),
        }),
      );
    },
  };
}
