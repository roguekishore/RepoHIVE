/**
 * In-memory DynamoDB stand-in for ledger contract tests (hosting-2 Requirement 10.7).
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

type Item = Record<string, AttributeValue>;

function pkOf(item: Item): string {
  const pk = item.pk?.S;
  if (!pk) {
    throw new Error("item missing pk");
  }
  return pk;
}

function cloneItem(item: Item): Item {
  return structuredClone(item);
}

function evalAttrNotExists(item: Item | undefined, path: string): boolean {
  if (path !== "pk") {
    throw new Error(`unsupported condition path: ${path}`);
  }
  return item === undefined;
}

function numberValue(item: Item | undefined, attr: string): number {
  const raw = item?.[attr]?.N;
  return raw === undefined ? 0 : Number(raw);
}

function applyUpdate(
  item: Item | undefined,
  updateExpression: string,
  values: Record<string, AttributeValue>,
): Item {
  const pk = item?.pk ?? values[":pk"];
  const next: Item = item ? cloneItem(item) : { pk: pk! };
  if (updateExpression.includes("if_not_exists(inflight, :zero) + :one")) {
    const current = numberValue(next, "inflight");
    next.inflight = { N: String(current + 1) };
    return next;
  }
  if (updateExpression.includes("inflight - :one")) {
    const current = numberValue(next, "inflight");
    next.inflight = { N: String(Math.max(0, current - 1)) };
    return next;
  }
  throw new Error(`unsupported update: ${updateExpression}`);
}

function checkInflightCap(item: Item | undefined, cap: number): boolean {
  if (item === undefined || item.inflight?.N === undefined) {
    return true;
  }
  return Number(item.inflight.N) < cap;
}

export function createFakeDynamoDbClient(): DynamoDBClient {
  const tables = new Map<string, Map<string, Item>>();

  function table(name: string): Map<string, Item> {
    let t = tables.get(name);
    if (!t) {
      t = new Map();
      tables.set(name, t);
    }
    return t;
  }

  const client = {
    async send(command: unknown): Promise<unknown> {
      if (command instanceof GetItemCommand) {
        const input = command.input;
        const pk = input.Key?.pk?.S;
        if (!pk || !input.TableName) {
          throw new Error("invalid GetItem");
        }
        const item = table(input.TableName).get(pk);
        return { Item: item ? cloneItem(item) : undefined };
      }

      if (command instanceof PutItemCommand) {
        const input = command.input;
        if (!input.TableName || !input.Item) {
          throw new Error("invalid PutItem");
        }
        const pk = pkOf(input.Item);
        const store = table(input.TableName);
        const existing = store.get(pk);
        const condition = input.ConditionExpression;
        if (condition === "attribute_not_exists(pk)") {
          if (!evalAttrNotExists(existing, "pk")) {
            throw new Error("ConditionalCheckFailedException");
          }
        } else if (condition?.includes("leaseUntilMs")) {
          const now = Number(input.ExpressionAttributeValues?.[":now"]?.N ?? 0);
          const jobId = input.ExpressionAttributeValues?.[":jobId"]?.S;
          const held = existing?.jobId?.S;
          const leaseUntil = numberValue(existing, "leaseUntilMs");
          if (existing && held !== jobId && leaseUntil > now) {
            throw new Error("ConditionalCheckFailedException");
          }
        }
        store.set(pk, cloneItem(input.Item));
        return {};
      }

      if (command instanceof UpdateItemCommand) {
        const input = command.input;
        const pk = input.Key?.pk?.S;
        if (!pk || !input.TableName || !input.UpdateExpression) {
          throw new Error("invalid UpdateItem");
        }
        const store = table(input.TableName);
        const existing = store.get(pk);
        const values = input.ExpressionAttributeValues ?? {};
        if (input.ConditionExpression?.includes("inflight < :cap")) {
          const cap = Number(values[":cap"]?.N ?? 0);
          if (!checkInflightCap(existing, cap)) {
            throw new Error("ConditionalCheckFailedException");
          }
        }
        const updated = applyUpdate(existing, input.UpdateExpression, values);
        if (!updated.pk) {
          updated.pk = { S: pk };
        }
        store.set(pk, updated);
        return {};
      }

      if (command instanceof ScanCommand) {
        const input = command.input;
        if (!input.TableName) {
          throw new Error("invalid Scan");
        }
        const store = table(input.TableName);
        const since = input.ExpressionAttributeValues?.[":since"]?.S;
        const jobPrefix = input.ExpressionAttributeValues?.[":jobPrefix"]?.S ?? "JOB#";
        const items: Item[] = [];
        for (const item of store.values()) {
          const pk = item.pk?.S ?? "";
          const endedAt = item.endedAt?.S;
          if (!pk.startsWith(jobPrefix) || endedAt === undefined) {
            continue;
          }
          if (since !== undefined && endedAt <= since) {
            continue;
          }
          items.push(cloneItem(item));
        }
        return { Items: items };
      }

      if (command instanceof DeleteItemCommand) {
        const input = command.input;
        const pk = input.Key?.pk?.S;
        if (!pk || !input.TableName) {
          throw new Error("invalid DeleteItem");
        }
        const store = table(input.TableName);
        const existing = store.get(pk);
        if (input.ConditionExpression === "jobId = :jobId") {
          const expected = input.ExpressionAttributeValues?.[":jobId"]?.S;
          if (existing?.jobId?.S !== expected) {
            throw new Error("ConditionalCheckFailedException");
          }
        }
        store.delete(pk);
        return {};
      }

      throw new Error(`unsupported command: ${command}`);
    },
  };

  return client as unknown as DynamoDBClient;
}
