/**
 * Shared indexer collaborators for the app process (store, job ledger and repo lock reader).
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import {
  createDynamoDbJobLedger,
  createFileJobLedger,
  createLocalArtifactStore,
  createS3ArtifactStore,
  type ArtifactStore,
  type JobLedger,
} from "@repohive/indexer";
import { getAppConfig, type AppConfig } from "./config";
import { createRepoLockReader, type RepoLockReader } from "./repo-lock";

let cachedStore: ArtifactStore | undefined;
let cachedLedger: JobLedger | undefined;
let cachedDynamo: DynamoDBClient | undefined;

function getDynamoClient(config: AppConfig): DynamoDBClient {
  cachedDynamo ??= new DynamoDBClient({ region: config.awsRegion });
  return cachedDynamo;
}

export function getArtifactStore(config: AppConfig = getAppConfig()): ArtifactStore {
  if (cachedStore === undefined) {
    cachedStore =
      config.store.kind === "local"
        ? createLocalArtifactStore(config.store.directory)
        : createS3ArtifactStore({ client: new S3Client({ region: config.awsRegion }), bucket: config.store.bucket });
  }
  return cachedStore;
}

export function getJobLedger(config: AppConfig = getAppConfig()): JobLedger {
  if (cachedLedger === undefined) {
    cachedLedger =
      config.ledger.kind === "file"
        ? createFileJobLedger({ path: config.ledger.path })
        : createDynamoDbJobLedger(getDynamoClient(config), {
            tableName: config.ledger.table,
          });
  }
  return cachedLedger;
}

/** Reads the per-repository lock from the same ledger the job ledger writes (the DynamoDB table when hosted). */
export function getRepoLockReader(config: AppConfig = getAppConfig()): RepoLockReader {
  return createRepoLockReader(config, config.ledger.kind === "dynamodb" ? getDynamoClient(config) : undefined);
}

/** Vitest-only: replace or clear cached clients. */
export function resetHostingClientsForTests(store?: ArtifactStore, ledger?: JobLedger): void {
  cachedStore = store;
  cachedLedger = ledger;
}
