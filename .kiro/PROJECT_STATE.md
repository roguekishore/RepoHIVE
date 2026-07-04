# Project State — RepoHIVE

> **READ THIS FIRST every session.** Live progress ledger. Update it after meaningful work.
> For decision rationale see `PROJECT_PLAN.md`; for canonical operational context see `.kiro/steering/`.

---

## Current position

- **Phase:** Project setup / backbone (pre-code).
- **Next review:** First Review — **03.07.2026** — deliverable: **parser** (`parse` → `graph.json`).
- **Next action:** Create the `dependency-graph-parser` spec (requirements → design → tasks), then
  scaffold `packages/shared` (the JSON contract types) and `packages/parser`.

---

## Done

- [x] Master plan written (`.kiro/PROJECT_PLAN.md`).
- [x] Removed nested `.git` repos from both MCP servers (functionality intact).
- [x] Reorganized workspace: `tooling/` (MCP servers), `docs/reference/` (brief + v3 deck),
      `archive/` (resume + old decks). Updated `mcp.json` paths; servers re-enabled.
- [x] Steering docs created: product, architecture, tech-stack, performance-and-scale,
      competitive-landscape, roadmap, review-timeline, git-workflow.
- [x] State ledger, AGENTS.md, doc seeds, root config, folder spine created.
- [x] Existing core spec: Graphify → RepoHIVE rename.

## In progress

- (nothing yet — backbone just laid)

## Next up (Review 1 — Parser)

- [ ] `dependency-graph-parser` spec: requirements → design → tasks.
- [ ] `packages/shared`: JSON-contract types (GraphNode, DependencyEdge, etc.).
- [ ] `packages/parser`: Tree-Sitter Java → stitch → `graph.json`.
- [ ] Pick a small open-source Java repo as `fixtures/sample-java-project`.

## Known gaps / open questions

- **Parser produces the graph that the core algorithm consumes** — must target the existing spec's
  exact schema. (Resolved decision; flagged here as a reminder during build.)
- Frequency signals (import/call/shared-type) start simple; sharpen later.
- Git not yet initialized (will set up with the user, walking through each step).
- Final project name **RepoHIVE** locked; command names still TBD (placeholders in use).

---

## Decisions log (most recent first)

- **2026-07-04** — Added `commit-assist` hook (userTriggered): proposes convention-based commits on
  confirmation. Chosen over postTaskExecution auto-commit. `log-task-completion` keep/remove: pending.
- **2026-07-04** — Documented commit convention in `git-workflow.md`: product types
  (`feat/fix/test/refactor/chore`) vs `kiro(...)` meta type; commit memory/state files on `main`.
- **2026-07-04** — Logging switched to 24-hour timestamps (`YYYY-MM-DD HH:mm`) across hooks + rules.
- **2026-07-04** — Expanded `sync-docs-on-stop` hook (v2): PROJECT_STATE + BRAIN auto-updated;
  research-log + project-diary are draft-for-approval only (plagiarism-safe, human-owned artifacts).
- **2026-06-22** — Project name finalized: **RepoHIVE** (Repository Hierarchical Indexing &
  Visualization Engine). Replaces the FlowGraph placeholder across all docs. Command names remain TBD.
- **2026-06-22** — Stack finalized: TS/Node, Tree-Sitter, graphology, Louvain/Leiden, React/React
  Flow, JSON storage, npm workspaces. MySQL removed. Neo4j deferred to 8th sem.
- **2026-06-22** — Graphify researched: it's 63K-star prior art with single global Leiden clustering;
  our edge narrowed to adaptive multi-level hierarchy + determinism; Graphify becomes our baseline;
  validated the no-embeddings decision.
- **2026-06-22** — Embeddings deferred to a semantic search/naming layer; never for grouping.
- **2026-06-22** — Cloud/auth not needed for core; telemetry deferred; skill = top distribution lever.
- **2026-06-22** — Path 1 (degree + paper) chosen now; Path 2 (viral) deferred, architecture kept open.
- **2026-06-22** — Workspace reorganized; backbone docs generated.
