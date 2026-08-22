/**
 * Index_Loader (spec R4) — the single component of the viewer that reads the
 * filesystem.
 *
 * It parses an Index_Directory using the grouping package's own parser
 * (`@repohive/core` `parseIndex`), so the viewer and the engine agree on
 * exactly what constitutes a valid index (R4.2). On failure it returns the
 * parser's own error (Result), which the route handler turns into a clear HTTP
 * response carrying the reason and the file involved (R4.3/R4.4).
 *
 * Server-only: this module reads from disk. Import it only from Route Handlers
 * or other server code, never from a client component.
 */

import { parseIndex, describeError } from "@repohive/core";
import type { Hierarchy, Metadata, Result } from "@repohive/core";

export type LoadedIndex = { hierarchy: Hierarchy; metadata: Metadata };

/** Read + parse the five-file Index_File_Set at `dir`. */
export function loadIndex(dir: string): Result<LoadedIndex> {
  return parseIndex(dir);
}

export { describeError };
export type { Hierarchy, Metadata };
