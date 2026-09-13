# @repohive/mcp

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server over a produced RepoHIVE
`index/` directory. It gives an AI agent structured access to what the engine recorded about a Java
repository: the multi-level hierarchy (repository → groups → files → classes/functions), the dependency
edges, blast-radius analysis, and — the part no plain code-graph server has — the recorded per-region
**preserve/reconstruct decisions** with their structural-quality scores and confidence.

This is an ecosystem package: it imports `@repohive/core` (whose `parseIndex` is the single definition of
a valid index) and `@repohive/shared`. Engine packages never import from it. It spawns no subprocess and
does not depend on the CLI.

**v1 is read-only.** The server reads an index the user already produced. It indexes nothing.

## Launch

The server speaks MCP over stdio and serves exactly **one** index directory, fixed at launch:

```
node packages/mcp/dist/server.js --index /abs/path/to/index
node packages/mcp/dist/server.js /abs/path/to/index
REPOHIVE_INDEX=/abs/path/to/index node packages/mcp/dist/server.js
```

Build first (`npm run build --workspace @repohive/mcp` from the repository root). The directory is the
five-file set produced by the group stage: `repository.json`, `hierarchy.json`, `nodes.json`,
`edges.json`, `metadata.json`.

Example MCP client configuration (Claude Code `.mcp.json`, same shape for other hosts):

```json
{
  "mcpServers": {
    "repohive": {
      "command": "node",
      "args": [
        "/abs/path/to/repohive/packages/mcp/dist/server.js",
        "--index",
        "/abs/path/to/your-project/index"
      ]
    }
  }
}
```

Relative paths resolve against the server process's working directory, which the host controls — prefer
absolute paths in configuration.

**One index per server process, by design.** An agent host configures MCP servers per project, so the
index is launch configuration, not a per-call argument. That keeps every tool call free of repeated path
arguments and means a tool call can never steer the process into reading arbitrary filesystem paths: the
process only ever reads the directory it was launched with. Serving several repositories means launching
several entries. A multi-index registry is a hosted-deployment concern, deliberately out of v1.

A missing or invalid index at launch is a warning, not a crash: every tool call reports the same specific
error (with the pipeline commands to fix it) until a valid index appears. Loads are cached against a
size+mtime signature of the five files, so re-running `group` is picked up on the next tool call — a
long-lived server never serves a stale index.

Diagnostics go to stderr; stdout carries only the protocol.

## The tools

Six tools. Every output is JSON in the result's text content. All id lists are canonically ordered
(ascending id), page/truncation cuts happen on that canonical order with explicit `truncated` flags and
totals, and identical index input yields byte-identical output. On failure a tool returns `isError: true`
with a message that names the problem and the tool to try instead (unknown ids point at `find_node`,
missing indexes at the pipeline commands).

Output schemas below use TypeScript notation; `X | null` means the field is always present and `null`
carries meaning documented next to it. Nullability is how this server expresses "the engine did not emit
this" — it never invents a value.

### 1. `repository_overview`

The orientation call: make it first. Repository shape, which levels exist (so `hierarchy_at_level` can be
called with real level numbers), the grouping run's parameters, and the honest summary of the recorded
decisions.

Input: none.

```ts
{
  indexDir: string;                    // absolute path being served
  repositoryId: string;                // "r_<hash>"
  hierarchyDepth: number;              // levels, 0 = repository node
  nodeCount: number;                   // hierarchy nodes incl. groups + repository
  edgeCount: number;                   // leafEdgeCount + crossGroupEdgeCount
  leafEdgeCount: number;
  crossGroupEdgeCount: number;
  averageBranchingFactor: number;
  nodeKindCounts: { repository: number; group: number; file: number; class: number; function: number };
  perLevel: Array<{ level: number; groupNodeCount: number; leafNodeCount: number;
                    leafEdgeCount: number; crossGroupEdgeCount: number }>;
  regionDecisions: DecisionSummary;    // see "Decision honesty" below
  structuralQualityBoundary: number;
  metricWeights: { cohesion: number; coupling: number; modularity: number | null };
  cohesionSquashConstant: number;
  configuration: RunConfiguration | null;  // full resolved run config; null = index predates the field
}
```

### 2. `hierarchy_at_level`

All nodes at one hierarchy level, canonically ordered and paged — level-at-a-time reading instead of
pulling tens of thousands of nodes. Level 0 is the repository node, level 1 the top-level architecture.

Input:

```ts
{
  level: number;    // integer >= 0; out of range fails naming the valid range
  offset?: number;  // integer >= 0, default 0
  limit?: number;   // integer 1..500, default 100
}
```

```ts
{
  level: number;
  totalAtLevel: number;
  offset: number;
  returned: number;
  truncated: boolean;
  nodes: Array<{
    id: string;
    kind: "repository" | "group" | "file" | "class" | "function";
    name: string | null;               // derived display aid, never an identity; null = nothing derivable
    parentId: string | null;           // null only on the repository node
    childCount: number;
    descendantFileCount: number;       // count of file-kind descendants (a file counts itself)
    packagePrefix: string | null;      // groups: derived common package prefix (may be ""); null otherwise
    packagePath: string | null;        // leaves: declared Java package; null = contract omission or non-leaf
    directoryPath: string | null;      // leaves: "" is a real value (project root); null = non-leaf
    definedInFile: string | null;      // class/function: the declaring file node
    region: { regionId: string; ordinal: number } | null;  // engine-recorded provenance; null = none recorded
    decision: {                        // joined via regionId; null = no provenance or no recorded decision
      action: "preserve" | "reconstruct";
      assessed: boolean;               // see "Decision honesty"
      score: number;
      decisionConfidence: number;      // NOT informative when assessed is false
      userOverridden: boolean;
    } | null;
  }>;
}
```

### 3. `find_node`

The bridge from names an agent knows — file paths, class/function names, package names, region ids — to
the node ids every other tool takes. Case-insensitive substring match over `id`, `packagePath`,
`directoryPath`, group `packagePrefix` and `regionId`. Exact id matches rank first, then id substrings,
then attribute matches; ties break on ascending id.

Input:

```ts
{
  query: string;    // non-empty substring
  kind?: "file" | "class" | "function" | "group" | "repository";
  limit?: number;   // integer 1..100, default 20
}
```

```ts
{
  query: string;
  totalMatches: number;
  returned: number;
  truncated: boolean;
  matches: Array<{
    id: string;
    kind: "repository" | "group" | "file" | "class" | "function";
    level: number;
    name: string | null;
    matchedOn: "id" | "packagePath" | "directoryPath" | "packagePrefix" | "regionId";
    packagePath: string | null;
    directoryPath: string | null;
    region: { regionId: string; ordinal: number } | null;
  }>;
}
```

### 4. `node_details`

Everything the index records about one node: hierarchy position (root-first ancestors, children), leaf
attributes, region provenance, the full joined decision for groups, and direct one-hop dependency edges
in both directions. This is the surface's answer to "what does X depend on / who depends on X";
`blast_radius` answers the transitive version, in the dependents direction only.

Input:

```ts
{
  nodeId: string;      // exact id, from find_node or hierarchy_at_level
  edgeLimit?: number;  // integer 1..500 per direction, default 100
}
```

```ts
{
  id: string;
  kind: "repository" | "group" | "file" | "class" | "function";
  level: number;
  name: string | null;
  parentId: string | null;
  ancestors: Array<{ id: string; kind: string; level: number; name: string | null }>; // root first
  childCount: number;
  childrenTruncated: boolean;          // children list is capped at 50
  children: Array<{ id: string; kind: string; name: string | null }>;
  descendantFileCount: number;
  packagePrefix: string | null;
  packagePath: string | null;
  directoryPath: string | null;
  definedInFile: string | null;
  region: { regionId: string; ordinal: number } | null;
  decision: DecisionRecord | null;     // full record (see region_decisions); groups with provenance only
  // Leaf kinds (file/class/function) carry leaf edges; both null on group/repository nodes:
  dependencies: { total: number; truncated: boolean;
                  edges: Array<{ target: string; importFrequency: number; methodCallFrequency: number;
                                 sharedTypeCount: number; strength: number }> } | null;
  dependents:   { total: number; truncated: boolean;
                  edges: Array<{ source: string; importFrequency: number; methodCallFrequency: number;
                                 sharedTypeCount: number; strength: number }> } | null;
  // Group kind carries aggregated same-level cross-group edges; both null on other kinds:
  groupDependencies: { total: number; truncated: boolean;
                       edges: Array<{ target: string; level: number; weight: number }> } | null;
  groupDependents:   { total: number; truncated: boolean;
                       edges: Array<{ source: string; level: number; weight: number }> } | null;
}
```

### 5. `blast_radius`

Change-impact scoping before an edit: the engine's reverse-reachability analysis
(`analyzeBlastRadius`). Given a node about to change, every node whose dependency path reaches it, plus
the group nodes containing any impacted leaf — which files and which parts of the architecture to
re-check.

Input:

```ts
{
  nodeId: string;   // exact id of the entity about to change
  limit?: number;   // integer 1..2000 per list, default 500
}
```

```ts
{
  nodeId: string;
  impactedNodeCount: number;           // includes the queried node itself (engine semantics)
  kindBreakdown: { repository: number; group: number; file: number; class: number; function: number };
  impactedNodes: string[];             // canonical order, first `limit`
  truncated: boolean;
  containingGroupCount: number;
  containingGroups: Array<{ id: string; name: string | null; regionId: string | null }>;
  containingGroupsTruncated: boolean;
}
```

### 6. `region_decisions`

The differentiator: the recorded per-region audit trail of the adaptive grouping. For every region the
engine assessed, it recorded cohesion, coupling, the combined structural-quality score, the
preserve/reconstruct action taken (and the automatic action, when a user override diverged), the
confidence, and the group nodes the decision produced. What an agent does with it: calibrate trust in
authored package boundaries (a preserved high-score region is a boundary that held; a reconstructed
region flags a package whose structure did not), and explain why the hierarchy groups files the way it
does.

Input (all optional; filters compose):

```ts
{
  action?: "preserve" | "reconstruct";
  assessed?: boolean;   // true = assessed only; false = unassessed only; omit = all
  regionId?: string;    // exact region id, e.g. "pkg:com.example.orders"; unknown ids fail with guidance
  groupId?: string;     // the one decision that produced this group node (exact regionId join)
  offset?: number;      // integer >= 0, default 0
  limit?: number;       // integer 1..500, default 100
}
```

```ts
{
  structuralQualityBoundary: number;
  metricWeights: { cohesion: number; coupling: number; modularity: number | null };
  cohesionSquashConstant: number;
  communityDetectionSeed: number | null;  // null = index predates recorded configuration
  summary: DecisionSummary;               // over ALL decisions, regardless of filters
  totalMatching: number;
  offset: number;
  returned: number;
  truncated: boolean;
  regions: DecisionRecord[];              // canonical (regionId-ascending) order
}

// DecisionRecord — the recorded fields verbatim, plus the labelled derivations:
{
  regionId: string;                    // "pkg:<package>" or "dir:<directory>"
  displayName: string;                 // regionId without its scheme prefix (display aid)
  assessed: boolean;                   // derived; see "Decision honesty"
  cohesion: number;
  coupling: number;
  modularity: number | null;           // null = the run did not compute modularity
  score: number;                       // combined structural quality in [0, 1]
  action: "preserve" | "reconstruct";
  automaticAction: "preserve" | "reconstruct";  // recorded even when overridden
  userOverridden: boolean;
  decisionConfidence: number;          // |score - boundary|; NOT informative when assessed is false
  groupIds: string[] | null;           // groups this decision produced; null = index predates the field
  memberFileCount: number;             // files whose nearest regioned ancestor carries this region
}
```

## Decision honesty: the `assessed` flag

The engine assigns regions that cannot be measured (fewer than two nodes, or no internal edges) a score
by rule rather than by assessment. In the emitted index those regions are recognizable **only** by
`score === 0 && cohesion === 0` — there is no explicit flag — yet they carry
`decisionConfidence = |score − boundary|`, which for a rule-assigned zero score is the full boundary
distance (0.5 with the default boundary, the dataset **maximum**). Read naively, the regions that were
never assessed look like the most confident decisions in the run. On real repositories this is not an
edge case: on the broadleaf reference index, 216 of 502 regions (43%) are unassessed.

This server therefore:

- exposes every recorded field verbatim, **and** a derived `assessed: boolean` implementing exactly the
  recorded rule `assessed = !(score === 0 && cohesion === 0)`, adjacent to every score/confidence it
  emits;
- never emits a raw preserve/reconstruct split: every summary (`DecisionSummary`) splits actions over
  assessed regions only and counts unassessed regions separately, with an always-present `note`
  explaining the framing:

```ts
// DecisionSummary
{
  totalRegions: number;
  assessedRegions: number;
  unassessedRegions: number;
  assessed: { preserve: number; reconstruct: number };  // never split over unassessed regions
  userOverridden: number;
  note: string;  // the framing, in words, so it travels with the numbers
}
```

Caveat: the rule is exact for indexes produced with the default configuration (`degenerateScore` 0). A
run configured with a non-zero `degenerateScore` would make unassessed regions undetectable from the
emitted fields. That is an engine emission gap; this package does not paper over it by recomputing
degeneracy from the graph.

## Data honesty, generally

The rules the viewer's `Zoom_Map_Adapter` established bind this server too:

- **Read, never recompute.** No tool computes cohesion, coupling, a score, a decision, a confidence, or
  a community. Every such value is read from the index. Fields the engine did not emit are explicit
  `null`s — never invented values.
- **Exact joins only.** A group joins its decision through the engine-recorded `regionId` (and a
  decision names its groups through `groupIds`). Path and package-prefix heuristics are never used for
  joins — such a heuristic existed once in the viewer and was removed. The only prefix-derived values are
  labelled display aids (`name`, `packagePrefix`, `displayName`), and they are never used as identities.
- **Provenance lives where the engine put it.** Group provenance (`regionId`, `ordinal`) is emitted in
  `nodes.json`, not `hierarchy.json` (which holds only the tree). The `Hierarchy` this server works over
  is the **assembled** view returned by `parseIndex()` across all five files — `leafAttributes`,
  `leafEdges` and `crossGroupEdges` are properties of that assembled object, not keys in any single file
  on disk. A group without `regionId` is either a repository fan-out wrapper (belongs to no region by
  construction) or from an index that predates provenance emission; tools say which rather than guessing.
- **Canonical order everywhere.** Id lists ascend; regions sort by regionId; truncation cuts the
  canonical order under an explicit limit with a `truncated` flag. Identical index input produces
  byte-identical tool output.

## What v1 deliberately does not do

- **No `index` / `parse` / `group` tool.** Recorded scope decision: a fire-and-forget indexing tool
  drags in a job model (spawn, status, cancellation), and at ~14 s warm (~57 s cold) the pipeline is
  borderline for interactive tool timeouts. Deferred, not impossible. Produce the index with the
  pipeline, point the server at it.
- **Local only.** Stdio transport over a local directory. The engine's read path goes straight to the
  filesystem (`index-parser.ts`), which is exactly right for a local server; a hosted MCP needs the
  read-path storage seam first.
- **No source text.** The index records structure, not file contents. Agents read code with their own
  tools.
- **No multi-index registry, no per-call index paths.** One process, one directory, fixed at launch.
- **No graph computations beyond what the engine recorded** — no path-finding, no centrality, no derived
  metrics.

## Testing

Handlers are pure functions over a loaded view and are tested against a **real** index: `make-fixture`
runs the actual pipeline (parse, then group) over `fixtures/sample-java-project` into git-ignored paths
inside the fixture directory. The pipeline is deterministic, so the fixture is identical wherever it is
generated.

```
npm run build --workspace @repohive/mcp
npm test --workspace @repohive/mcp        # pretest generates the fixture if absent
```

## Licence

AGPL-3.0-or-later, like the rest of RepoHIVE. Direct dependencies: `@modelcontextprotocol/sdk` (MIT),
`zod` (MIT).
