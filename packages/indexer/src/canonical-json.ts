/**
 * Canonical JSON and byte-wise ordering, for the snapshot id and the
 * manifest.
 */
import { createHash } from "node:crypto";

/** A JSON value the canonical serializer accepts. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Orders two strings by their UTF-8 bytes, not by UTF-16 code units. */
export function compareBytewise(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Serializes `value` with object keys sorted byte-wise at every level and no
 * whitespace. Rejects what JSON cannot represent exactly (non-finite numbers),
 * so two equal inputs always give the same string.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalJson: ${value} is not a finite number`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: JsonValue) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(record).sort(compareBytewise);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] as JsonValue)}`).join(",")}}`;
}

/** Lowercase hex SHA-256 of `content` (a string is hashed as UTF-8). */
export function sha256Hex(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}
