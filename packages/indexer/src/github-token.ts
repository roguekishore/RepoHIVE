/**
 * The GitHub token from SSM Parameter Store (hosting-4 Requirement 12.4). The Lambda function is configured with the
 * parameter's name, never the token, so the token is not in the function's environment or in Terraform state.
 */
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { IndexerConfig } from "./config.js";

/**
 * The token to use: `REPOHIVE_GITHUB_TOKEN` when set, else the value of `REPOHIVE_GITHUB_TOKEN_PARAMETER` read with
 * decryption, else `undefined` (a local run). The error never carries the value.
 */
export async function resolveGithubToken(
  config: Pick<IndexerConfig, "githubToken" | "githubTokenParameter">,
  client: Pick<SSMClient, "send"> = new SSMClient({}),
): Promise<string | undefined> {
  if (config.githubToken !== undefined || config.githubTokenParameter === undefined) {
    return config.githubToken;
  }
  let value: string | undefined;
  try {
    const out = await client.send(new GetParameterCommand({ Name: config.githubTokenParameter, WithDecryption: true }));
    value = out.Parameter?.Value?.trim();
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown error";
    throw new Error(`could not read the GitHub token parameter ${config.githubTokenParameter}: ${reason}`);
  }
  if (value === undefined || value === "") {
    throw new Error(`the GitHub token parameter ${config.githubTokenParameter} is empty`);
  }
  return value;
}
