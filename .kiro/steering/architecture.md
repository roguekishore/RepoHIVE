# Architecture — RepoHIVE

> Always-on context. Project name RepoHIVE (final); commands `parse`/`group`/`view` are placeholders.
> See `PROJECT_PLAN.md` for the full rationale.

## Two tracks: Engine vs Ecosystem

- **Engine (must be excellent, 7th sem, local-only):** parse → group → view, plus blast radius.
  No cloud, no auth, no database.
- **Ecosystem (deferred, 8th sem+):** skill, MCP server, VS Code extension, hosted service, Neo4j,
  cloud, auth, telemetry. All wrap the engine; none change it.

Keep this line bright. Every change belongs clearly on one side.

## The pipeline (stateless file-handoff)

```
Java repo  →  [parse]  →  graph.json  →  [group]  →  index/*.json  →  [view]  →  browser
```

- **parse** — Tree-Sitter makes a per-file AST (transient), the parser stitches ASTs into one
  cross-file dependency graph → `graph.json`.
- **group** — core algorithm: ingest → weight → assess → adaptive construct → build hierarchy →
  `index/` (repository.json, hierarchy.json, nodes.json, edges.json, metadata.json).
- **view** — React + React Flow semantic-zoom viewer + flat baseline viewer.

## Key architecture facts (for review answers)

- **Tree-Sitter only gives per-file ASTs; OUR parser stitches them into a cross-file graph.**
- **ASTs are transient** — one file's AST in memory at a time, then discarded. The graph is the
  persisted artifact. ASTs are never stored.
- **No always-on backend in 7th sem.** Phases are batch processes that read/write files and exit.
  Only the viewer (and later MCP server) stay running, reading pre-computed JSON.
- **The JSON contract is the universal seam.** Parser writes it; everything else reads it. New
  consumers plug in with zero engine rework as long as the contract holds.

## The JSON contract (the stable seam)

Defined in the existing core spec; the parser targets this exact shape:

```typescript
interface GraphNode { id; kind: "file"|"function"|"class"; packagePath?; directoryPath; definedInFile?; }
interface DependencyEdge { source; target; importFrequency; methodCallFrequency; sharedTypeCount; strength?; }
```

Frequency numbers may start simple and sharpen later; the *shape* is correct from day one.

## Distribution surfaces (all consume the same engine + JSON contract)

```
CLI (base)  →  Skill + MCP (thin wrappers over CLI/JSON)  →  VS Code extension
```

CLI cleanliness and self-describing JSON are the enablers — keep them sound from day one so the
ecosystem wrappers attach later with no rework.

## Future hooks (rooms left open; NOT built now)

- **Embeddings** → semantic layer on top for search + cluster naming. Never for grouping.
- **Neo4j** → storage abstracted behind an interface; swap JSON→Neo4j for a hosted service.
- **Cloud / auth / telemetry** → wrap the engine; the engine never changes to gain them.

## Folder structure (developer-standard monorepo)

`.kiro/` MUST stay at the workspace root, so **`D:\PROJECTS\GRAPH` IS the project root** (no
`repohive/` subfolder). The structure is a **spine, not a cage** — it looks small now and fills with
*depth* as packages grow. New products = new package folders. Do NOT pre-create empty folders for
code that doesn't exist (v1, refactorable; the JSON contract is the stable seam that makes refactoring safe).

```
D:\PROJECTS\GRAPH\
├── .kiro/            steering, specs, settings, PROJECT_PLAN.md, PROJECT_STATE.md
├── .vscode/
├── AGENTS.md  README.md  LICENSE
├── package.json  tsconfig.base.json  .gitignore  .editorconfig
├── .github/workflows/         CI (added with git setup)
├── packages/
│   ├── shared/   JSON-contract types only (the stable seam)
│   ├── parser/   Tree-Sitter → graph.json            [Review 1]
│   ├── core/     grouping algorithm + blast radius    [Review 2]
│   ├── cli/      wires packages; parse/group/view
│   └── web/      React + React Flow viewer            [Review 3]  (components/, hooks/ live here)
├── docs/         research-log.md, project-diary.md, reference/
├── fixtures/sample-java-project/
├── tooling/      MCP servers (git-ignored)
└── archive/      resume + old decks (git-ignored)
```
