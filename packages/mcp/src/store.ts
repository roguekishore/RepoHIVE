/**
 * IndexStore - the single component of this package that touches the
 * filesystem. It loads the index through the engine's own `parseIndex`, so the
 * MCP server and the engine agree on exactly what constitutes a valid index
 * (the viewer's Index_Loader follows the same rule).
 *
 * Loads are cached against a size+mtime signature of the five index files, so
 * an unchanged index parses once per server lifetime while a re-run of the
 * group stage is picked up on the next tool call - a long-lived server never
 * silently serves a stale index.
 */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describeError, INDEX_FILE_NAMES, parseIndex } from "@repohive/core";
import { buildIndexView, type IndexView } from "./view.js";

export type LoadResult = { ok: true; view: IndexView } | { ok: false; message: string };

export interface IndexStore {
  readonly indexDir: string;
  load(): LoadResult;
}

const PIPELINE_HINT =
  "Generate an index by running the RepoHIVE pipeline over a Java project: " +
  "`npm run parse -- <java-project-dir>` then `npm run group -- <graph.json>` " +
  "(from the RepoHIVE repository root), and point this server at the produced index/ directory.";

/**
 * Size+mtime signature of the five index files. Any change (including a file
 * disappearing) changes the signature and invalidates the cached view.
 */
function signatureOf(indexDir: string): string {
  const parts: string[] = [];
  for (const name of INDEX_FILE_NAMES) {
    try {
      const stat = statSync(join(indexDir, name));
      parts.push(`${name}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      parts.push(`${name}:absent`);
    }
  }
  return parts.join("|");
}

export function createIndexStore(dir: string): IndexStore {
  const indexDir = resolve(dir);
  let cached: { signature: string; outcome: LoadResult } | null = null;

  const loadFresh = (): LoadResult => {
    if (!existsSync(indexDir)) {
      return {
        ok: false,
        message:
          `index directory not found: ${indexDir}. Expected a RepoHIVE index/ directory ` +
          `containing ${INDEX_FILE_NAMES.join(", ")}. ${PIPELINE_HINT}`,
      };
    }
    const parsed = parseIndex(indexDir);
    if (!parsed.ok) {
      return {
        ok: false,
        message: `could not load the RepoHIVE index at ${indexDir}: ${describeError(parsed.error)}. ${PIPELINE_HINT}`,
      };
    }
    return { ok: true, view: buildIndexView(indexDir, parsed.value) };
  };

  return {
    indexDir,
    load(): LoadResult {
      const signature = signatureOf(indexDir);
      if (cached !== null && cached.signature === signature) {
        return cached.outcome;
      }
      const outcome = loadFresh();
      cached = { signature, outcome };
      return outcome;
    },
  };
}
