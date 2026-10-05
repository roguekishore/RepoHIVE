/**
 * Background worker: polls the ledger every 10 seconds.
 */
import {
  createDynamoDbJobLedger,
  createFileJobLedger,
  createLocalArtifactStore,
  createS3ArtifactStore,
} from "@repohive/indexer";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { parseAppConfig } from "../src/lib/hosting/config.ts";
import { openAppDatabase } from "../src/lib/app-db/database.ts";
import { APP_DB_FILENAME } from "../src/lib/app-db/schema.ts";
import { runWorkerTick } from "../src/lib/worker/tick.ts";
import { join } from "node:path";

const config = parseAppConfig(process.env);
const db = openAppDatabase(join(config.dataDirectory, APP_DB_FILENAME));

const store =
  config.store.kind === "local"
    ? createLocalArtifactStore(config.store.directory)
    : createS3ArtifactStore({ client: new S3Client({ region: config.awsRegion }), bucket: config.store.bucket });

const ledger =
  config.ledger.kind === "file"
    ? createFileJobLedger({ path: config.ledger.path })
    : createDynamoDbJobLedger(new DynamoDBClient({ region: config.awsRegion }), {
        tableName: config.ledger.table,
      });

const INTERVAL_MS = 10_000;

async function tick() {
  try {
    const result = await runWorkerTick(config, db, ledger, store);
    if (result.processed > 0 || result.backupTaken) {
      console.log(JSON.stringify({ level: "info", msg: "worker tick", ...result }));
    }
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "worker tick failed", error: String(error) }));
  }
}

await tick();
setInterval(() => {
  void tick();
}, INTERVAL_MS);
