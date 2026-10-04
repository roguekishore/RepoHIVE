/**
 * Shared indexer collaborators for the app process (store and job ledger).
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

let cachedStore: ArtifactStore | undefined;
let cachedLedger: JobLedger | undefined;

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
        : createDynamoDbJobLedger(new DynamoDBClient({ region: config.awsRegion }), {
            tableName: config.ledger.table,
          });
  }
  return cachedLedger;
}

/** Vitest-only: replace or clear cached clients. */
export function resetHostingClientsForTests(store?: ArtifactStore, ledger?: JobLedger): void {
  cachedStore = store;
  cachedLedger = ledger;
}
