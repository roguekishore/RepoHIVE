/**
 * DynamoDB {@link JobLedger} (hosting-2 Requirement 10).
 */
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { JobLedger, JobProgress, JobRecord } from "./job-ledger.js";
import type { ClaimResult, JobEnd } from "./job-ledger.js";
import type { JobInput, JobState, Tier } from "./job-types.js";
import {
  DEFAULT_INFLIGHT_CAP,
  PROGRESS_WRITE_INTERVAL_MS,
  isForwardJobTransition,
} from "./job-ledger-states.js";
import {
  INFLIGHT_PK,
  LARGE_SLOT_PK,
  applyJobEnd,
  jobPk,
  listJobsEndedSinceFromRecords,
  newJobRecord,
  repoPk,
  withProgress,
  withRequeueTier,
  withTransition,
  type StoredJob,
} from "./job-ledger-util.js";

export interface DynamoDbJobLedgerOptions {
  readonly tableName: string;
  readonly inflightCap?: number;
  readonly nowMs?: () => number;
}

function s(value: string): AttributeValue {
  return { S: value };
}

function n(value: number): AttributeValue {
  return { N: String(value) };
}

function storedJobToItem(stored: StoredJob): Record<string, AttributeValue> {
  const { input, state, failureClass, failureCode, progress, createdAt, updatedAt, endedAt, expiresAt } =
    stored;
  const item: Record<string, AttributeValue> = {
    pk: s(jobPk(input.jobId)),
    jobId: s(input.jobId),
    accountId: s(input.accountId),
    repo: s(input.repo),
    commitSha: s(input.commitSha),
    tier: s(input.tier),
    snapshotId: s(input.snapshotId),
    visibility: s(input.visibility),
    state: s(state),
    createdAt: s(createdAt),
    updatedAt: s(updatedAt),
  };
  if (failureClass !== undefined) {
    item.failureClass = s(failureClass);
  }
  if (failureCode !== undefined) {
    item.failureCode = s(failureCode);
  }
  if (progress !== undefined) {
    item.progressStage = s(progress.stage);
    if (progress.completed !== undefined) {
      item.progressCompleted = n(progress.completed);
    }
    if (progress.total !== undefined) {
      item.progressTotal = n(progress.total);
    }
  }
  if (endedAt !== undefined) {
    item.endedAt = s(endedAt);
  }
  if (expiresAt !== undefined) {
    item.expiresAt = n(expiresAt);
  }
  if (stored.lastProgressWriteMs !== undefined) {
    item.lastProgressWriteMs = n(stored.lastProgressWriteMs);
  }
  return item;
}

function itemToStoredJob(item: Record<string, AttributeValue>): StoredJob {
  const progressStage = item.progressStage?.S;
  const progress: JobProgress | undefined =
    progressStage === undefined
      ? undefined
      : {
          stage: progressStage,
          completed: item.progressCompleted?.N === undefined ? undefined : Number(item.progressCompleted.N),
          total: item.progressTotal?.N === undefined ? undefined : Number(item.progressTotal.N),
        };
  const jobId = item.jobId?.S;
  const accountId = item.accountId?.S;
  const repo = item.repo?.S;
  const commitSha = item.commitSha?.S;
  const tier = item.tier?.S;
  const snapshotId = item.snapshotId?.S;
  const state = item.state?.S;
  const createdAt = item.createdAt?.S;
  const updatedAt = item.updatedAt?.S;
  if (
    !jobId ||
    !accountId ||
    !repo ||
    !commitSha ||
    !tier ||
    !snapshotId ||
    !state ||
    !createdAt ||
    !updatedAt
  ) {
    throw new Error("corrupt job item");
  }
  const input: JobInput = {
    jobId,
    accountId,
    repo,
    commitSha,
    tier: tier as Tier,
    snapshotId,
    visibility: "public",
  };
  return {
    input,
    state: state as JobState,
    failureClass: item.failureClass?.S as StoredJob["failureClass"],
    failureCode: item.failureCode?.S,
    progress,
    createdAt,
    updatedAt,
    endedAt: item.endedAt?.S,
    expiresAt: item.expiresAt?.N === undefined ? undefined : Number(item.expiresAt.N),
    lastProgressWriteMs:
      item.lastProgressWriteMs?.N === undefined ? undefined : Number(item.lastProgressWriteMs.N),
  };
}

function toJobRecord(stored: StoredJob): JobRecord {
  const { lastProgressWriteMs: _ignored, ...record } = stored;
  return record;
}

export function createDynamoDbJobLedger(
  client: DynamoDBClient,
  options: DynamoDbJobLedgerOptions,
): JobLedger {
  const tableName = options.tableName;
  const inflightCap = options.inflightCap ?? DEFAULT_INFLIGHT_CAP;
  const nowMs = options.nowMs ?? (() => Date.now());

  async function getStoredJob(jobId: string): Promise<StoredJob | undefined> {
    const out = await client.send(
      new GetItemCommand({
        TableName: tableName,
        Key: { pk: s(jobPk(jobId)) },
      }),
    );
    if (!out.Item) {
      return undefined;
    }
    return itemToStoredJob(out.Item);
  }

  return {
    async claim(input: JobInput): Promise<ClaimResult> {
      const repoLock = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { pk: s(repoPk(input.repo)) },
        }),
      );
      if (repoLock.Item?.jobId?.S) {
        return { claimed: false, reason: "repo-in-flight", jobId: repoLock.Item.jobId.S };
      }

      const inflightRow = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { pk: s(INFLIGHT_PK) },
        }),
      );
      const inflight = inflightRow.Item?.inflight?.N === undefined ? 0 : Number(inflightRow.Item.inflight.N);
      if (inflight >= inflightCap) {
        return { claimed: false, reason: "inflight-cap" };
      }

      try {
        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { pk: s(INFLIGHT_PK) },
            UpdateExpression: "SET inflight = if_not_exists(inflight, :zero) + :one",
            ConditionExpression: "attribute_not_exists(inflight) OR inflight < :cap",
            ExpressionAttributeValues: {
              ":zero": n(0),
              ":one": n(1),
              ":cap": n(inflightCap),
            },
          }),
        );
      } catch {
        return { claimed: false, reason: "inflight-cap" };
      }

      try {
        await client.send(
          new PutItemCommand({
            TableName: tableName,
            Item: { pk: s(repoPk(input.repo)), jobId: s(input.jobId) },
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        );
      } catch {
        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { pk: s(INFLIGHT_PK) },
            UpdateExpression: "SET inflight = inflight - :one",
            ExpressionAttributeValues: { ":one": n(1) },
          }),
        );
        const again = await client.send(
          new GetItemCommand({
            TableName: tableName,
            Key: { pk: s(repoPk(input.repo)) },
          }),
        );
        if (again.Item?.jobId?.S) {
          return { claimed: false, reason: "repo-in-flight", jobId: again.Item.jobId.S };
        }
        return { claimed: false, reason: "inflight-cap" };
      }

      const stored = newJobRecord(input);
      try {
        await client.send(
          new PutItemCommand({
            TableName: tableName,
            Item: storedJobToItem(stored),
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        );
      } catch {
        await client.send(new DeleteItemCommand({ TableName: tableName, Key: { pk: s(repoPk(input.repo)) } }));
        await client.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { pk: s(INFLIGHT_PK) },
            UpdateExpression: "SET inflight = inflight - :one",
            ExpressionAttributeValues: { ":one": n(1) },
          }),
        );
        throw new Error("job id collision");
      }

      return { claimed: true, jobId: input.jobId };
    },

    async get(jobId: string): Promise<JobRecord | undefined> {
      const stored = await getStoredJob(jobId);
      return stored ? toJobRecord(stored) : undefined;
    },

    async transition(jobId: string, to: JobState): Promise<void> {
      const stored = await getStoredJob(jobId);
      if (!stored) {
        throw new Error(`unknown job: ${jobId}`);
      }
      if (!isForwardJobTransition(stored.state, to)) {
        throw new Error(`invalid transition from ${stored.state} to ${to}`);
      }
      const next = withTransition(stored, to);
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: storedJobToItem(next),
        }),
      );
    },

    async writeProgress(jobId: string, progress: JobProgress): Promise<void> {
      const stored = await getStoredJob(jobId);
      if (!stored) {
        throw new Error(`unknown job: ${jobId}`);
      }
      const t = nowMs();
      if (
        stored.lastProgressWriteMs !== undefined &&
        t - stored.lastProgressWriteMs < PROGRESS_WRITE_INTERVAL_MS
      ) {
        return;
      }
      const next: StoredJob = { ...withProgress(stored, progress), lastProgressWriteMs: t };
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: storedJobToItem(next),
        }),
      );
    },

    async requeue(jobId: string, tier: Tier): Promise<void> {
      const stored = await getStoredJob(jobId);
      if (!stored) {
        throw new Error(`unknown job: ${jobId}`);
      }
      const next = withRequeueTier(stored, tier);
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: storedJobToItem(next),
        }),
      );
    },

    async finish(jobId: string, end: JobEnd): Promise<void> {
      const stored = await getStoredJob(jobId);
      if (!stored) {
        throw new Error(`unknown job: ${jobId}`);
      }
      const next = applyJobEnd(stored, end);
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: storedJobToItem(next),
        }),
      );
      await client.send(
        new DeleteItemCommand({
          TableName: tableName,
          Key: { pk: s(repoPk(stored.input.repo)) },
        }),
      );
      await client.send(
        new UpdateItemCommand({
          TableName: tableName,
          Key: { pk: s(INFLIGHT_PK) },
          UpdateExpression: "SET inflight = inflight - :one",
          ExpressionAttributeValues: { ":one": n(1) },
        }),
      );
    },

    async acquireLargeSlot(jobId: string, leaseUntilMs: number): Promise<boolean> {
      const row = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { pk: s(LARGE_SLOT_PK) },
        }),
      );
      const t = nowMs();
      const heldBy = row.Item?.jobId?.S;
      const leaseUntil =
        row.Item?.leaseUntilMs?.N === undefined ? 0 : Number(row.Item.leaseUntilMs.N);
      if (heldBy !== undefined && heldBy !== jobId && leaseUntil > t) {
        return false;
      }
      try {
        await client.send(
          new PutItemCommand({
            TableName: tableName,
            Item: { pk: s(LARGE_SLOT_PK), jobId: s(jobId), leaseUntilMs: n(leaseUntilMs) },
            ConditionExpression:
              "attribute_not_exists(pk) OR leaseUntilMs <= :now OR jobId = :jobId",
            ExpressionAttributeValues: {
              ":now": n(t),
              ":jobId": s(jobId),
            },
          }),
        );
        return true;
      } catch {
        return false;
      }
    },

    async releaseLargeSlot(jobId: string): Promise<void> {
      try {
        await client.send(
          new DeleteItemCommand({
            TableName: tableName,
            Key: { pk: s(LARGE_SLOT_PK) },
            ConditionExpression: "jobId = :jobId",
            ExpressionAttributeValues: { ":jobId": s(jobId) },
          }),
        );
      } catch {
        // Nothing to release.
      }
    },

    async listJobsEndedSince(sinceIso: string): Promise<readonly JobRecord[]> {
      const jobs: StoredJob[] = [];
      let exclusiveStartKey: Record<string, AttributeValue> | undefined;
      do {
        const page = await client.send(
          new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey: exclusiveStartKey,
            FilterExpression: "begins_with(pk, :jobPrefix) AND attribute_exists(endedAt) AND endedAt > :since",
            ExpressionAttributeValues: {
              ":jobPrefix": s("JOB#"),
              ":since": s(sinceIso),
            },
          }),
        );
        for (const item of page.Items ?? []) {
          jobs.push(itemToStoredJob(item));
        }
        exclusiveStartKey = page.LastEvaluatedKey;
      } while (exclusiveStartKey !== undefined);
      return listJobsEndedSinceFromRecords(jobs, sinceIso);
    },
  };
}
