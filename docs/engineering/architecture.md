# Architecture

System shape as built. Facts only.

## Pipeline

Three stateless stages that hand off through files on disk.

```
Java repo  →  [parse]  →  graph.json  →  [group]  →  index/*.json  →  [view]  →  browser
```

| Stage | Input | Output | Process model |
|-------|-------|--------|---------------|
| `parse` | a Java source tree | `graph.json` | batch; reads files, writes one file, exits |
| `group` | `graph.json` | `index/` (5 files) | batch; reads one file, writes five, exits |
| `view` | `index/` | HTTP + browser | long-running Next.js server |

`parse` internals: Tree-Sitter produces a per-file AST; the AST is held one file at a time and
discarded. Our stitcher resolves cross-file references and emits the graph. **ASTs are never
persisted.** `graph.json` is the artifact.

`group` internals: ingest → dependency strengths → region identification → structural-quality
assessment → adaptive preserve-vs-reconstruct construction → hierarchy assembly → metadata.

`index/` contents: `repository.json`, `hierarchy.json`, `nodes.json`, `edges.json`, `metadata.json`.
The list is enforced in `packages/core/src/index-serializer.ts`.

`graph.json` and `index/` are **git-ignored generated artifacts**. Reverting code does not restore the
artifacts that matched it; re-run the pipeline.

## The JSON contract (stable seam)

The parser writes it; every other component reads it. Adding fields is safe; changing or removing them
is a breaking change. Defined in `packages/shared/src/contract.ts`.

```typescript
type NodeKind = "file" | "function" | "class" | "group" | "repository";

interface GraphNode { id; kind: NodeKind; packagePath?; directoryPath; definedInFile?; }
interface DependencyEdge { source; target; importFrequency; methodCallFrequency; sharedTypeCount; strength?; }
```

`NodeKind` has five members, but **the parser emits only `file`, `class`, and `function`**. `group` and
`repository` are produced downstream by the grouping algorithm. Likewise `strength` is part of the
contract but is never emitted by the parser; the downstream weight calculation populates it.

Field omission, not empty string or null, is how the contract expresses "no value": `packagePath` is
absent when there is no declared Java package, and `definedInFile` is absent on `file` nodes.

A graph carries at most one edge per ordered `(source, target)` pair. Signals between the same two
entities are summed into a single edge before emission. Two edges over one pair get double-counted by
consumers that sum strength, which can inflate cohesion enough to flip a preserve/reconstruct decision,
so the grouping engine rejects such a graph rather than silently folding it. The opposite direction is a
different pair and is legitimately distinct.

Group nodes additionally carry `regionId` and `ordinal`; each recorded decision carries `groupIds`.
Join a group to the decision that produced it through those fields. **Never re-derive the association
from a path or package-prefix heuristic** (that heuristic existed once and was removed).

Node identity is scoped by source root: `class`/`function` ids carry a `<sourceRoot>|` prefix, omitted
when the scope is empty so single-root ids are unchanged. This is what makes multi-module repos work.

## Packages

```
packages/
  shared/       JSON-contract types (the stable seam)
  types/        shared TS types for the viewer/API surface
  parser/       Tree-Sitter Java → graph.json
  core/         grouping algorithm + blast radius
  cli/          EMPTY (.gitkeep only), the packaged CLI is not built
  api-client/   framework-free client for the REST surface
  ui/           shared UI components
  web/          Next.js 15 viewer + its route handlers
```

`shared` and `types` are leaf dependencies. `parser` and `core` depend only on `shared`. Nothing in
`parser` or `core` may import from `web`, `ui`, `api-client`, or `cli`.

**There is no pipeline-orchestration layer.** `parseProject` lives in `parser`, `groupGraphToIndex` in
`core`, and neither imports the other. parse→group exists only as two root npm scripts. A one-shot
`index <dir>` therefore has no home yet, and whichever surface is built first absorbs that logic.

## Viewer surface

`packages/web` serves its own Next.js route handlers over the pre-computed `index/`:

```
/api/workspace
/api/repos
/api/repos/[id]
/api/graph/[id]
/api/graph/[id]/blast-radius
/api/graph/[id]/region-decisions
/api/graph/[id]/zoom-map
```

These are the only seven route handlers under `packages/web/src/app/api`.

These routes are **unauthenticated and intended for localhost only.** No route file contains an auth,
session, or token check. They expose indexed source structure. Any change that binds them to a
non-loopback interface, or any deployment beyond a developer's own machine, requires authentication
first. Treat that as a blocking prerequisite, not a follow-up.

Rendering is level-at-a-time semantic zoom plus a flat baseline view for comparison, served from
`packages/web/src/app/repos/[id]/flat-baseline`. Layout is computed client-side.

Two long-standing descriptions of the renderer are recorded here but **not confirmed against the
current code**: that the per-level node budget is about 20, and that client-side layout is
deterministic (sorting by sibling rank, ties broken by id). Treat both as claims to re-derive before
relying on them.

## Engine / ecosystem boundary

- **Engine:** `parser`, `core`, `shared` are the parse/group/blast-radius logic.
- **Ecosystem:** `cli`, `web`, `ui`, `api-client`, and any future MCP server or editor extension.

Ecosystem code may depend on engine code. **Engine code may never depend on ecosystem code.** Every
change belongs clearly on one side of this line.

This rule currently holds. A grep for imports of `@repohive/web`, `ui`, `api-client`, `cli`, or `types`
across `packages/{parser,core,shared}/src` returns nothing, and neither `parser` nor `core` imports the
other. The only cross-package imports in engine source are 51 references to `@repohive/shared`.

## Repository layout

Tracked at the repository root:

```
packages/            see above
fixtures/            sample-java-project (the clone itself is git-ignored)
docs/engineering/    these documents
tsconfig.base.json   shared compiler options
components.json      shadcn component configuration
LICENSE / NOTICE     AGPL-3.0-or-later plus upstream attribution
README.md
.editorconfig
```

Vendored upstream code is not a separate top-level directory. It is merged into `packages/types`,
`packages/ui`, `packages/api-client`, and `packages/web`, with per-package attribution in `NOTICE`.

Deliberately absent from the public repository, all git-ignored: `context/` (project state, decision
history, and registers; see below), `tooling/`, `archive/`, `node_modules/`, `dist/`,
`graph.json`, and `index/`.

`context/` is a private mount, not part of this repository:

```
context/STATE.md      current project state and recorded baselines
context/decisions/    decision history
context/registers/    the large registers
```

A contributor working from a public clone will not have `context/`. Anything that depends on it is
optional by construction. `docs/engineering/` is the durable, public half and must stand on its own.
