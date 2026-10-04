/**
 * Runtime configuration: all
 * environment variables, validated at start.
 *
 * - `REPOHIVE_STORE`: `local:<dir>` or `s3:<bucket>`
 * - `REPOHIVE_SERVER_URL`: the server's base URL for progress, outcome and active-snapshot calls (required for
 *   `lambda` and `fargate`, optional for `local`)
 * - `REPOHIVE_INTERNAL_SECRET`: the bearer secret for those calls (required for `lambda` and `fargate`, unless the
 *   parameter below is set)
 * - `REPOHIVE_INTERNAL_SECRET_PARAMETER`: the SSM SecureString holding the secret; read once per cold start when
 *   `REPOHIVE_INTERNAL_SECRET` is not set
 * - `REPOHIVE_GITHUB_TOKEN`: the server-side token (required outside `local`, unless the parameter below is set)
 * - `REPOHIVE_GITHUB_TOKEN_PARAMETER`: the SSM parameter holding the token; the Lambda entry points read it once per
 *   cold start when `REPOHIVE_GITHUB_TOKEN` is not set
 * - `REPOHIVE_RUNTIME`: `lambda`, `fargate` or `local`
 * - `AWS_REGION`: from the platform (required for `s3:` and for either parameter variable)
 */
import { S3Client } from "@aws-sdk/client-s3";
import type { ArtifactStore } from "./artifact-store.js";
import { createLocalArtifactStore } from "./artifact-store-local.js";
import { createS3ArtifactStore } from "./artifact-store-s3.js";
import type { Runtime } from "./telemetry.js";

export type StoreConfig = { kind: "local"; directory: string } | { kind: "s3"; bucket: string };

export interface IndexerConfig {
  readonly store: StoreConfig;
  /** The server's base URL, without a trailing slash; absent only for a local run. */
  readonly serverUrl: string | undefined;
  readonly internalSecret: string | undefined;
  /** SSM parameter name to read the internal secret from when `internalSecret` is not set. */
  readonly internalSecretParameter: string | undefined;
  readonly githubToken: string | undefined;
  /** SSM parameter name to read the token from when `githubToken` is not set. */
  readonly githubTokenParameter: string | undefined;
  readonly runtime: Runtime;
}

export class ConfigError extends Error {}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(`${name} is not set`);
  }
  return value.trim();
}

/** Reads and validates the configuration; throws a `ConfigError` naming the variable, never echoing a secret. */
export function loadConfig(env: NodeJS.ProcessEnv): IndexerConfig {
  const runtime = required(env, "REPOHIVE_RUNTIME");
  if (runtime !== "lambda" && runtime !== "fargate" && runtime !== "local") {
    throw new ConfigError("REPOHIVE_RUNTIME must be lambda, fargate or local");
  }

  const storeText = required(env, "REPOHIVE_STORE");
  let store: StoreConfig;
  if (storeText.startsWith("local:") && storeText.length > "local:".length) {
    store = { kind: "local", directory: storeText.slice("local:".length) };
  } else if (storeText.startsWith("s3:") && storeText.length > "s3:".length) {
    store = { kind: "s3", bucket: storeText.slice("s3:".length) };
  } else {
    throw new ConfigError("REPOHIVE_STORE must be local:<dir> or s3:<bucket>");
  }

  const githubToken = env.REPOHIVE_GITHUB_TOKEN?.trim() || undefined;
  const githubTokenParameter = env.REPOHIVE_GITHUB_TOKEN_PARAMETER?.trim() || undefined;
  if (runtime !== "local" && githubToken === undefined && githubTokenParameter === undefined) {
    throw new ConfigError("REPOHIVE_GITHUB_TOKEN is not set");
  }

  const serverUrlText = env.REPOHIVE_SERVER_URL?.trim() || undefined;
  let serverUrl: string | undefined;
  if (serverUrlText !== undefined) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(serverUrlText);
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      throw new ConfigError("REPOHIVE_SERVER_URL must be an http or https URL");
    }
    serverUrl = serverUrlText.replace(/\/+$/, "");
  } else if (runtime !== "local") {
    throw new ConfigError("REPOHIVE_SERVER_URL is not set");
  }
  const internalSecret = env.REPOHIVE_INTERNAL_SECRET?.trim() || undefined;
  const internalSecretParameter = env.REPOHIVE_INTERNAL_SECRET_PARAMETER?.trim() || undefined;
  if (runtime !== "local" && internalSecret === undefined && internalSecretParameter === undefined) {
    throw new ConfigError("REPOHIVE_INTERNAL_SECRET is not set");
  }

  if (
    (store.kind === "s3" || githubTokenParameter !== undefined || internalSecretParameter !== undefined) &&
    (env.AWS_REGION ?? "") === ""
  ) {
    throw new ConfigError("AWS_REGION is not set");
  }
  return { store, serverUrl, internalSecret, internalSecretParameter, githubToken, githubTokenParameter, runtime };
}

export function createStore(config: IndexerConfig): ArtifactStore {
  return config.store.kind === "s3"
    ? createS3ArtifactStore({ client: new S3Client({}), bucket: config.store.bucket })
    : createLocalArtifactStore(config.store.directory);
}
