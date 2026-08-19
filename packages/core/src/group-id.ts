/**
 * Content-addressed Group_Node identifiers (design: Group_Node identifier
 * scheme). An id is derived solely from the group's canonicalized membership —
 * never from counters, timestamps, wall-clock, randomness, memory addresses,
 * or input position — so the same contents always yield the same identifier
 * (Req 7.3) and distinct memberships yield distinct identifiers (Req 7.4;
 * hash collisions are surfaced by tests, not handled at runtime).
 */

import { createHash } from "node:crypto";
import { sortIds } from "./canonical.js";

/** `"g_" + sha1(canonical membership key)`. */
export function groupIdOf(childIds: readonly string[]): string {
  return `g_${digest(childIds)}`;
}

/** Repository-node id, same content-addressed scheme with its own prefix. */
export function repositoryIdOf(childIds: readonly string[]): string {
  return `r_${digest(childIds)}`;
}

function digest(childIds: readonly string[]): string {
  // JSON-encoding the sorted list gives an unambiguous membership key: no
  // separator character can collide with characters inside member ids (a
  // plain join would make ["a b"] and ["a", "b"] hash identically).
  const key = JSON.stringify(sortIds(childIds));
  return createHash("sha1").update(key, "utf8").digest("hex");
}
