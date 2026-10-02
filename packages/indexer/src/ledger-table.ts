/**
 * The DynamoDB table layout the ledger (`job-ledger-dynamodb.ts`) relies on. `deploy/terraform/main/ledger-schema.json`
 * must equal it; `ledger-table.test.ts` fails when either side drifts.
 *
 * There is no secondary index: "jobs ended since" is a filtered `Scan` over the `JOB#` rows
 * (`listJobsEndedSince`), which the table's size and the 30-day expiry keep small.
 */
export interface LedgerTableLayout {
  readonly keySchema: readonly { readonly attributeName: string; readonly keyType: "HASH" | "RANGE" }[];
  readonly attributeDefinitions: readonly { readonly attributeName: string; readonly attributeType: "S" | "N" | "B" }[];
  readonly globalSecondaryIndexes: readonly {
    readonly indexName: string;
    readonly keySchema: readonly { readonly attributeName: string; readonly keyType: "HASH" | "RANGE" }[];
    readonly projection: "ALL" | "KEYS_ONLY";
  }[];
  /** The attribute DynamoDB expires items by, in epoch seconds. */
  readonly ttlAttribute: string;
}

export const LEDGER_TABLE_LAYOUT: LedgerTableLayout = {
  keySchema: [{ attributeName: "pk", keyType: "HASH" }],
  attributeDefinitions: [{ attributeName: "pk", attributeType: "S" }],
  globalSecondaryIndexes: [],
  ttlAttribute: "expiresAt",
};
