import { describe, expect, it } from "vitest";
import { APP_DB_SCHEMA_VERSION } from "./schema";
import { openAppDatabase } from "./database";

describe("openAppDatabase", () => {
  it("creates schema_version on first open", () => {
    const db = openAppDatabase(":memory:");
    const row = db.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(row.version).toBe(APP_DB_SCHEMA_VERSION);
  });
});
