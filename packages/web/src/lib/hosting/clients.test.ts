import { describe, expect, it } from "vitest";
import { getRepoLockReader } from "./clients";
import type { AppConfig } from "./config";

describe("getRepoLockReader", () => {
  // The hosted /api/index built the reader without a DynamoDB client and failed every request with a 500.
  it("gives a DynamoDB ledger a client", () => {
    const config = { ledger: { kind: "dynamodb", table: "repohive-ledger" }, awsRegion: "ap-south-1" } as AppConfig;
    expect(() => getRepoLockReader(config)).not.toThrow();
  });

  it("reads a file ledger without a client", () => {
    const config = { ledger: { kind: "file", path: "/nonexistent/ledger.json" }, awsRegion: undefined } as AppConfig;
    expect(() => getRepoLockReader(config)).not.toThrow();
  });
});
