#!/usr/bin/env node
/**
 * repohive-mcp - read-only MCP server (stdio) over one produced RepoHIVE
 * index/ directory.
 *
 * One server serves one index, fixed at launch (`--index <dir>`, a positional
 * path, or the REPOHIVE_INDEX environment variable). That matches how agent
 * hosts configure MCP servers (one entry per project), keeps every tool call
 * free of repeated path arguments, and means the process can never be steered
 * into reading arbitrary filesystem paths at tool-call time.
 *
 * stdout carries the MCP protocol; every diagnostic goes to stderr.
 */

import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createIndexStore, type IndexStore } from "./store.js";
import {
  blastRadius,
  findNode,
  hierarchyAtLevel,
  LIMITS,
  nodeDetails,
  regionDecisions,
  repositoryOverview,
  type ToolResult,
} from "./tools.js";
import type { IndexView } from "./view.js";

const SERVER_NAME = "repohive";
const SERVER_VERSION = "0.0.0";

const USAGE = `repohive-mcp - read-only MCP server over a RepoHIVE index/ directory

usage: repohive-mcp [--index] <index-dir>
       REPOHIVE_INDEX=<index-dir> repohive-mcp

The directory is the five-file index/ produced by RepoHIVE's group stage
(repository.json, hierarchy.json, nodes.json, edges.json, metadata.json).
Relative paths resolve against the current working directory; prefer an
absolute path in MCP client configuration.`;

const INSTRUCTIONS = `Read-only access to a RepoHIVE index: a Java repository's dependency graph grouped
into a multi-level hierarchy (repository -> groups -> files -> classes/functions), with a recorded
per-region decision of whether the authored package structure was preserved or reconstructed by
community detection. Start with repository_overview, find ids with find_node, then drill in with
hierarchy_at_level / node_details / blast_radius / region_decisions. All data is read from the index;
nothing is recomputed. Regions where score and cohesion are both 0 were never assessed - treat their
decisionConfidence as uninformative (every tool marks these with assessed: false).`;

export type ResolveArgsResult =
  | { ok: true; indexDir: string }
  | { ok: true; help: true }
  | { ok: false; message: string };

/** Resolve the index directory from argv (`--index <dir>` or positional) or env. */
export function resolveIndexDirFromArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): ResolveArgsResult {
  const positionals: string[] = [];
  let indexFlag: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--help" || token === "-h") {
      return { ok: true, help: true };
    }
    if (token === "--index") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, message: "--index requires a directory path" };
      }
      indexFlag = value;
      continue;
    }
    if (token.startsWith("-")) {
      return { ok: false, message: `unknown option: ${token}` };
    }
    positionals.push(token);
  }
  if (positionals.length > 1) {
    return { ok: false, message: `unexpected extra argument: ${positionals[1]}` };
  }
  if (indexFlag !== undefined && positionals.length > 0) {
    return { ok: false, message: "pass the index directory either as --index or positionally, not both" };
  }
  const raw = indexFlag ?? positionals[0] ?? env["REPOHIVE_INDEX"];
  if (raw === undefined || raw.trim().length === 0) {
    return { ok: false, message: "no index directory given" };
  }
  return { ok: true, indexDir: resolve(cwd, raw.trim()) };
}

/** Serialize a handler outcome as an MCP tool result (JSON text on success). */
function toCallResult<T>(outcome: ToolResult<T>): CallToolResult {
  if (!outcome.ok) {
    return { isError: true, content: [{ type: "text", text: outcome.message }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(outcome.value, null, 2) }] };
}

/** Load the index, then run the handler over the loaded view. */
function withView<A, T>(
  store: IndexStore,
  handler: (view: IndexView, args: A) => ToolResult<T>,
): (args: A) => CallToolResult {
  return (args: A) => {
    const loaded = store.load();
    if (!loaded.ok) {
      return { isError: true, content: [{ type: "text", text: loaded.message }] };
    }
    return toCallResult(handler(loaded.view, args));
  };
}

const NODE_KIND = z.enum(["file", "class", "function", "group", "repository"]);

/** Build the MCP server with all six tools registered over `store`. */
export function buildServer(store: IndexStore): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "repository_overview",
    {
      title: "Repository overview",
      description:
        "Orientation call: repository shape (node/edge counts, hierarchy depth, per-level stats), " +
        "the grouping run's parameters, and an honest summary of the recorded preserve/reconstruct " +
        "region decisions (split over assessed regions only; unassessed regions are counted separately " +
        "because their recorded confidence is a formula artifact). Call this first.",
      inputSchema: {},
    },
    withView(store, (view) => repositoryOverview(view)),
  );

  server.registerTool(
    "hierarchy_at_level",
    {
      title: "Hierarchy at level",
      description:
        "All nodes at one hierarchy level, canonically ordered and paged: level 0 is the repository " +
        "node, level 1 the top-level architecture, deeper levels are groups, then files, then " +
        "classes/functions. Each node carries its parent, child count, descendant file count, region " +
        "provenance and (for groups) the joined decision. Use repository_overview's perLevel to pick a level.",
      inputSchema: {
        level: z.number().int().min(0).describe("Hierarchy level to list (0 = repository node)"),
        offset: z.number().int().min(0).optional().describe("Skip this many nodes (default 0)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.hierarchyNodes.max)
          .optional()
          .describe(`Maximum nodes to return (default ${LIMITS.hierarchyNodes.default})`),
      },
    },
    withView(store, hierarchyAtLevel),
  );

  server.registerTool(
    "find_node",
    {
      title: "Find node",
      description:
        "Look up node ids from names an agent knows: file paths, class/function names, package names, " +
        "region ids. Case-insensitive substring match over id, packagePath, directoryPath, group package " +
        "prefix and regionId; exact id matches rank first. Every other tool takes the ids this returns.",
      inputSchema: {
        query: z.string().min(1).describe("Substring to search for (path, package, class name, id)"),
        kind: NODE_KIND.optional().describe("Restrict matches to one node kind"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.findMatches.max)
          .optional()
          .describe(`Maximum matches to return (default ${LIMITS.findMatches.default})`),
      },
    },
    withView(store, findNode),
  );

  server.registerTool(
    "node_details",
    {
      title: "Node details",
      description:
        "Everything the index records about one node: hierarchy position (ancestors, children), leaf " +
        "attributes, region provenance, the full joined decision for groups, and direct one-hop " +
        "dependency edges in both directions (leaf edges for file/class/function nodes, aggregated " +
        "cross-group edges for group nodes). Answers 'what does X depend on / who depends on X'.",
      inputSchema: {
        nodeId: z.string().min(1).describe("Exact node id (from find_node or hierarchy_at_level)"),
        edgeLimit: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.detailEdges.max)
          .optional()
          .describe(`Maximum edges per direction (default ${LIMITS.detailEdges.default})`),
      },
    },
    withView(store, nodeDetails),
  );

  server.registerTool(
    "blast_radius",
    {
      title: "Blast radius",
      description:
        "Change-impact analysis (transitive, dependents direction): given a node about to change, " +
        "every node whose dependency path reaches it, plus the group nodes containing any impacted " +
        "leaf. Use before an edit to scope which files and which parts of the architecture to re-check. " +
        "For direct one-hop edges (either direction) use node_details.",
      inputSchema: {
        nodeId: z.string().min(1).describe("Exact node id of the entity about to change"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.blastNodes.max)
          .optional()
          .describe(`Maximum ids to return in each list (default ${LIMITS.blastNodes.default})`),
      },
    },
    withView(store, blastRadius),
  );

  server.registerTool(
    "region_decisions",
    {
      title: "Region decisions",
      description:
        "The recorded per-region preserve/reconstruct decisions of the adaptive grouping: structural " +
        "quality score, cohesion, coupling, confidence, override status, and the group nodes each " +
        "decision produced. Preserved high-score regions are authored boundaries that held; " +
        "reconstructed regions flag packages whose structure did not. Regions with assessed: false " +
        "were never assessed (score === 0 && cohesion === 0 by recorded rule) - never read their " +
        "decisionConfidence as evidence. The summary is always framed over assessed regions only.",
      inputSchema: {
        action: z.enum(["preserve", "reconstruct"]).optional().describe("Filter by recorded action"),
        assessed: z
          .boolean()
          .optional()
          .describe("true = assessed regions only; false = unassessed only; omit for all"),
        regionId: z.string().min(1).optional().describe('Exact region id (e.g. "pkg:com.example.orders")'),
        groupId: z
          .string()
          .min(1)
          .optional()
          .describe("Return only the decision that produced this group node"),
        offset: z.number().int().min(0).optional().describe("Skip this many regions (default 0)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.regionDecisions.max)
          .optional()
          .describe(`Maximum regions to return (default ${LIMITS.regionDecisions.default})`),
      },
    },
    withView(store, regionDecisions),
  );

  return server;
}

async function main(): Promise<void> {
  const resolved = resolveIndexDirFromArgs(process.argv.slice(2), process.env, process.cwd());
  if (!resolved.ok) {
    console.error(`repohive-mcp: ${resolved.message}`);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if ("help" in resolved) {
    console.error(USAGE);
    return;
  }

  const store = createIndexStore(resolved.indexDir);
  const probe = store.load();
  if (probe.ok) {
    console.error(
      `repohive-mcp: serving index at ${resolved.indexDir} ` +
        `(${probe.view.metadata.nodeCount} nodes, ${probe.view.summary.totalRegions} regions)`,
    );
  } else {
    // Not fatal: the index may be generated after launch; tools report the
    // same error with guidance until it appears.
    console.error(`repohive-mcp: warning: ${probe.message}`);
  }

  const server = buildServer(store);
  await server.connect(new StdioServerTransport());
}

// Executed only when run as a script (directly or via the bin shim), not when
// imported by a test.
const entry = process.argv[1];
if (entry !== undefined && (entry.endsWith("server.js") || entry.endsWith("repohive-mcp"))) {
  main().catch((cause: unknown) => {
    console.error(
      `repohive-mcp: fatal: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    process.exitCode = 1;
  });
}
