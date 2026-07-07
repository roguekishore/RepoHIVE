---
name: task-researcher
description: Use at the start of a task to populate the Discovery section of a personal vault task-record with real, concretely-referenced facts about the code and data model. Triggers include "research the codebase", "discovery", "trace this flow", or starting a task.
alwaysApply: false
globs:
---

# Task Researcher

Produce the Discovery section of a vault task-record: an accurate, reference-dense map of what the relevant code and data model actually do, so decisions come from facts. Read-only on source code; write only to the `personal` vault.

## Input
A task-record under `D:\Vaults\personal-brain\tasks\` whose `## Intake` states the ask (or a raw area — then ask for the record id/title first).

## Repo architecture
RepoHIVE (Repository Hierarchical Indexing & Visualization Engine) is a **TypeScript / Node.js monorepo** (npm workspaces). It is a batch, stateless, file-handoff engine — there is no always-on backend and no database; JSON files on disk are the storage. The pipeline is:

```
Java repo  ->  [parse]  ->  graph.json  ->  [group]  ->  index/*.json  ->  [view]  ->  browser
```

Packages (`packages/`), each a workspace:
- **`shared/`** — the JSON-contract TypeScript types only (`GraphNode`, `DependencyEdge`, `RawDependencyGraph`). This is the **stable seam**: the parser writes it, everything else reads it. Start here when a task touches data shape. Source: `packages/shared/src/`.
- **`parser/`** — **[Review 1, DONE]** Tree-Sitter Java (`web-tree-sitter` + `tree-sitter-java` WASM). Reads a Java project dir, extracts a per-file AST (transient — one at a time, then discarded), collects file/class/function nodes, builds a symbol table, then **stitches** cross-file `import` references into a de-duplicated directed weighted dependency graph with three frequency signals (`importFrequency` counted; `methodCallFrequency`/`sharedTypeCount` at Phase-1 zero), and serializes a canonical, stable `graph.json`. Determinism = content-derived IDs + canonical ordering (no timestamps/`Math.random`). Entry point: the `parseProject` orchestrator (error-gated, no partial output); demo wrapper `npm run parse -- <dir>`. Source: `packages/parser/src/`.
- **`core/`** — **[Review 2, NOT yet built — empty]** the grouping algorithm: ingest `graph.json` -> weight edges -> assess each region's structural quality (cohesion + coupling) -> **adaptive per-region preserve-vs-reconstruct** (reconstruct via Louvain community detection behind a `CommunityDetector` interface) -> build the multi-level hierarchy -> write `index/` (`repository.json`, `hierarchy.json`, `nodes.json`, `edges.json`, `metadata.json`). Deterministic: seeded PRNG over canonically-sorted nodes/edges. Design lives in `.kiro/specs/hierarchical-repository-grouping/`.
- **`cli/`** — wires the packages; exposes `parse`/`group`/`view` (command names are placeholders).
- **`web/`** — React + React Flow semantic-zoom viewer ("Google Maps for code") + a flat baseline viewer. `components/` and `hooks/` live here.

Where things live for navigation:
- Data model / contract -> `packages/shared/src/*.ts` and `.kiro/steering/architecture.md`.
- Parse flow (AST extraction, symbol table, stitching, serialization) -> `packages/parser/src/`.
- Determinism proof -> the `verifyDeterminism` harness + `npm run demo:determinism`; tests are `fast-check` property tests.
- Fixtures (ground truth) -> `fixtures/sample-java-project/` (hand-written, ~29 nodes / 5 edges, checked-in `graph.json`) and `fixtures/vantage/` (a real Spring Boot repo with a generated `graph.json`).
- Durable project context -> `.kiro/PROJECT_STATE.md`, `.kiro/BRAIN.md`, `.kiro/steering/*.md`, `.kiro/specs/*`.

## How to work
1. Read the record's `## Intake`. Search the vault (`search_notes`/`build_context`) for existing `knowledge/`/`decisions/` so you don't re-discover facts.
2. Trace the flow hop by hop with grep/glob/read: entry point -> logic -> storage. Cite exact file paths and symbol names (line numbers where possible).
3. RepoHIVE has no DB. Ground data-model claims in the JSON-contract types in `packages/shared` and in real generated artifacts (`graph.json`, `index/`) read-only — never assume shape, verify it against the types or a sample artifact.
4. Note gaps/inconsistencies/risks (these seed Decisions/Complications) but do NOT make decisions.
5. Write the Discovery section back (replace the `## Discovery` section), preserving other sections. Add 2-4 `- [discovery] ... #discovery` observations for load-bearing facts.

## Boundaries
- Read-only on code; only write to the `personal` vault.
- Cite real locations; if unverified, say so rather than inventing.
- Facts over prose.
