/**
 * The Terraform table schema and the layout the DynamoDB ledger uses must agree (hosting-4 Requirement 6.3).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { LEDGER_TABLE_LAYOUT } from "./ledger-table.js";

// dist/ledger-table.test.js -> packages/indexer/dist -> repository root
const schemaPath = fileURLToPath(new URL("../../../deploy/terraform/main/ledger-schema.json", import.meta.url));

test("deploy/terraform/main/ledger-schema.json equals the layout the DynamoDB ledger uses", () => {
  const schema: unknown = JSON.parse(readFileSync(schemaPath, "utf8"));
  assert.deepEqual(schema, LEDGER_TABLE_LAYOUT);
});

test("the layout is a single string partition key with no sort key and the expiry attribute", () => {
  assert.deepEqual(LEDGER_TABLE_LAYOUT.keySchema, [{ attributeName: "pk", keyType: "HASH" }]);
  assert.deepEqual(LEDGER_TABLE_LAYOUT.attributeDefinitions, [{ attributeName: "pk", attributeType: "S" }]);
  assert.equal(LEDGER_TABLE_LAYOUT.ttlAttribute, "expiresAt");
});
