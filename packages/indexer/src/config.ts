/**
 * Runtime configuration (hosting-2 guide, "Runtimes and configuration"): all
 * environment variables, validated at start.
 *
 * - `REPOHIVE_STORE`: `local:<dir>` or `s3:<bucket>`
 * - `REPOHIVE_LEDGER`: `memory`, `file:<path>` or `dynamodb:<table>`
 * - `REPOHIVE_GITHUB_TOKEN`: the server-side token (required outside `local`)
 * - `REPOHIVE_RUNTIME`: `lambda`, `fargate` or `local`
 * - `AWS_REGION`: from the platform (required for `s3:` and `dynamodb:`)
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import type { ArtifactStore } from "./artifact-store.js";
import { createLocalArtifactStore } from "./artifact-store-local.js";
import { createS3ArtifactStore } from "./artifact-store-s3.js";
import { createDynamoDbJobLedger } from "./job-ledger-dynamodb.js";
import { createFileJobLedger } from "./job-ledger-file.js";
import { createMemoryJobLedger } from "./job-ledger-memory.js";
import type { JobLedger } from "./job-ledger.js";
import type { Runtime } from "./telemetry.js";

export type StoreConfig = { kind: "local"; directory: string } | { kind: "s3"; bucket: string };
export type LedgerConfig =
  | { kind: "memory" }
  | { kind: "file"; path: string }
  | { kind: "dynamodb"; table: string };

export interface IndexerConfig {
  readonly store: StoreConfig;
  readonly ledger: LedgerConfig;
  readonly githubToken: string | undefined;
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

  const ledgerText = required(env, "REPOHIVE_LEDGER");
  let ledger: LedgerConfig;
  if (ledgerText === "memory") {
    ledger = { kind: "memory" };
  } else if (ledgerText.startsWith("file:") && ledgerText.length > "file:".length) {
    ledger = { kind: "file", path: ledgerText.slice("file:".length) };
  } else if (ledgerText.startsWith("dynamodb:") && ledgerText.length > "dynamodb:".length) {
    ledger = { kind: "dynamodb", table: ledgerText.slice("dynamodb:".length) };
  } else {
    throw new ConfigError("REPOHIVE_LEDGER must be memory, file:<path> or dynamodb:<table>");
  }

  const githubToken = env.REPOHIVE_GITHUB_TOKEN?.trim() || undefined;
  if (runtime !== "local" && githubToken === undefined) {
    throw new ConfigError("REPOHIVE_GITHUB_TOKEN is not set");
  }
  if ((store.kind === "s3" || ledger.kind === "dynamodb") && (env.AWS_REGION ?? "") === "") {
    throw new ConfigError("AWS_REGION is not set");
  }
  return { store, ledger, githubToken, runtime };
}

export function createStore(config: IndexerConfig): ArtifactStore {
  return config.store.kind === "s3"
    ? createS3ArtifactStore({ client: new S3Client({}), bucket: config.store.bucket })
    : createLocalArtifactStore(config.store.directory);
}

export function createLedger(config: IndexerConfig): JobLedger {
  switch (config.ledger.kind) {
    case "memory":
      return createMemoryJobLedger();
    case "file":
      return createFileJobLedger({ path: config.ledger.path });
    case "dynamodb":
      return createDynamoDbJobLedger(new DynamoDBClient({}), { tableName: config.ledger.table });
  }
}
