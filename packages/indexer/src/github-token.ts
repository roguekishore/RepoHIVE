/**
 * Secrets from SSM Parameter Store. A function is configured with the parameter's name,
 * never the value, so the value is not in the function's environment or in Terraform state. Used for the GitHub
 * token and the internal secret; each is read once per cold start.
 */
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { IndexerConfig } from "./config.js";

/**
 * The secret to use: `value` when set, else the parameter read with decryption, else `undefined` (a local run).
 * `label` names the secret in errors (for example "GitHub token"). The error never carries the value.
 */
export async function resolveSecret(
  secret: { readonly value: string | undefined; readonly parameter: string | undefined; readonly label: string },
  client: Pick<SSMClient, "send"> = new SSMClient({}),
): Promise<string | undefined> {
  if (secret.value !== undefined || secret.parameter === undefined) {
    return secret.value;
  }
  let value: string | undefined;
  try {
    const out = await client.send(new GetParameterCommand({ Name: secret.parameter, WithDecryption: true }));
    value = out.Parameter?.Value?.trim();
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown error";
    throw new Error(`could not read the ${secret.label} parameter ${secret.parameter}: ${reason}`);
  }
  if (value === undefined || value === "") {
    throw new Error(`the ${secret.label} parameter ${secret.parameter} is empty`);
  }
  return value;
}

/** The GitHub token: `REPOHIVE_GITHUB_TOKEN` when set, else the parameter, else `undefined` (a local run). */
export function resolveGithubToken(
  config: Pick<IndexerConfig, "githubToken" | "githubTokenParameter">,
  client?: Pick<SSMClient, "send">,
): Promise<string | undefined> {
  return resolveSecret({ value: config.githubToken, parameter: config.githubTokenParameter, label: "GitHub token" }, client);
}

/** The internal secret: `REPOHIVE_INTERNAL_SECRET` when set, else the parameter, else `undefined`. */
export function resolveInternalSecret(
  config: Pick<IndexerConfig, "internalSecret" | "internalSecretParameter">,
  client?: Pick<SSMClient, "send">,
): Promise<string | undefined> {
  return resolveSecret(
    { value: config.internalSecret, parameter: config.internalSecretParameter, label: "internal secret" },
    client,
  );
}
