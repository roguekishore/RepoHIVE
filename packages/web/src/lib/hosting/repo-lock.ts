/**
 * Reads a repository lock from the job ledger without claiming.
 */
import { readFileSync } from "node:fs";
import { GetItemCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { AppConfig } from "./config";

interface RepoLockRow {
  readonly kind: "repo";
  readonly jobId: string;
}

type FileRow = RepoLockRow | { readonly kind: string };

function repoPk(repo: string): string {
  return `REPO#${repo}`;
}

function jobIdFromFileLedger(ledgerPath: string, repo: string): string | undefined {
  try {
    const raw = readFileSync(ledgerPath, "utf8");
    const parsed = JSON.parse(raw) as { rows?: Record<string, FileRow> };
    const row = parsed.rows?.[repoPk(repo)] as RepoLockRow | undefined;
    if (row?.kind === "repo") {
      return row.jobId;
    }
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export interface RepoLockReader {
  findInFlightJobId(repo: string): Promise<string | undefined>;
}

export function createRepoLockReader(config: AppConfig, dynamo?: DynamoDBClient): RepoLockReader {
  if (config.ledger.kind === "file") {
    const path = config.ledger.path;
    return {
      findInFlightJobId: async (repo) => jobIdFromFileLedger(path, repo),
    };
  }
  if (dynamo === undefined) {
    throw new Error("DynamoDB repo lock reader requires a client");
  }
  const tableName = config.ledger.table;
  return {
    findInFlightJobId: async (repo) => {
      const out = await dynamo.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { pk: { S: repoPk(repo) } },
        }),
      );
      const jobId = out.Item?.jobId?.S;
      return jobId === undefined || jobId === "" ? undefined : jobId;
    },
  };
}
