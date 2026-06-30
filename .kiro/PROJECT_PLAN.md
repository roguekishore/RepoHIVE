# RepoHIVE — Master Plan (Index + Decision Log)

> **Role:** the human entry point to understand the project and *why* each decision was made.
> **Operational detail lives in the steering files** (`.kiro/steering/`), which are the canonical,
> always-loaded source. This file does NOT duplicate them — it indexes them and records the rationale
> behind each decision so the reasoning is never lost.
> **Name:** **RepoHIVE** — Repository Hierarchical Indexing & Visualization Engine (final). Commands
> `parse`/`group`/`view` are placeholders — not final. Last updated: 2026-06-22.

---

## Where everything lives (index)

| Topic | Canonical file |
|-------|----------------|
| Vision, users, edge, defense claims, caveats | `steering/product.md` |
| Engine-vs-ecosystem, pipeline, JSON contract, folder structure, future hooks | `steering/architecture.md` |
| Stack choices (what's in / removed / deferred) | `steering/tech-stack.md` |
| Timings, file sizes, scale tiers, cost factors | `steering/performance-and-scale.md` |
| Graphify/Sourcegraph analysis, naming, distribution | `steering/competitive-landscape.md` |
| Deferred items + seams, Path 1 vs Path 2 | `steering/roadmap.md` |
| Dates, three-beat arc, rubric mapping | `steering/review-timeline.md` |
| Git practice (taught from scratch) | `steering/git-workflow.md` |
| Live progress, next action, decisions log | `PROJECT_STATE.md` |
| Agent entry point + rules of engagement | `../AGENTS.md` |
| Core grouping algorithm (full spec) | `specs/hierarchical-repository-grouping/` |

If this file ever conflicts with a steering file, **the steering file wins** (it is the canonical source).

---

## The project in three lines

- A hierarchical codebase indexing engine: flat dependency graph → navigable multi-level hierarchy
  (Repository → Groups → Files → Functions), via `parse → group → view`.
- Core contribution: **adaptive, per-region** preserve-vs-reconstruct construction, **deterministic**.
- Final-year project (2 semesters, 6 reviews) + a 0%-plagiarism paper.

---

## Decision log — WHAT was decided and WHY

This is the unique value of this file: the reasoning, condensed. (The *what* is also in steering;
the *why* is captured here so future decisions stay consistent with past intent.)

1. **TypeScript/Node, not Spring Boot** — packaging drives everything. We need npx/CLI/MCP/VS Code
   distribution; Spring Boot cannot be packaged as an easy CLI. Node also matches the React viewer and
   the JS graph ecosystem (graphology).

2. **Tree-Sitter, Java-first** — Tree-Sitter only emits per-file ASTs; our parser stitches them into a
   cross-file graph. Java's explicit imports make static resolution tractable. Multi-language only if
   low-effort, never at the cost of complexity.

3. **JSON files, no database (core)** — the data is small (~10–20 MB at 4k files) and the pipeline is
   stateless file-handoff. MySQL was **removed**. Neo4j is **deferred** to 8th sem and only if a hosted
   service is built (it's graph-native — better fit than MySQL — behind a storage interface seam).

4. **Structural grouping, NOT embeddings** — embedding-based grouping is subjective (model-dependent,
   irreproducible, unexplainable, and circular to the thesis). Structure is verifiable and
   deterministic. Independently validated: Graphify (63k stars) also clusters by topology with no
   embeddings. Embeddings are deferred to a *search/naming* layer on top — never for grouping.

5. **Adaptive per-region is the novelty** — existing tools (incl. Graphify) apply one global clustering
   strategy. Real repos are mixed-quality, so we preserve well-structured regions and reconstruct messy
   ones. This is a *hypothesis to prove* (wins on mixed repos; never worse than global), not a theorem.

6. **Two separate, honest claims** — (A) hierarchy beats flat for *navigation/retrieval* (not "more
   accurate" clustering); (B) adaptive beats single-global on *mixed* repos. Each has a caveat and a
   required experiment. Token savings: graph-over-raw-files is table stakes (shared with Graphify);
   hierarchy-over-flat-graph is our incremental gain — measure it, never claim "71x".

7. **Engine vs ecosystem split** — the local engine (parse/group/view + blast radius) is the research
   and 7th-sem deliverable; cloud, auth, telemetry, skill, MCP, VS Code extension are deferred ecosystem
   wrappers. The JSON contract is the seam that keeps the door open with zero engine rework.

8. **Path 1 now, Path 2 deferred** — finish the degree + paper (scoped, low-risk). Virality is a
   distribution game (~80% hustle), not an algorithm game; a better algorithm does not cause virality.
   Architecture stays open so Path 2 is possible after graduation. The **skill** is the highest-ROI
   distribution lever (how Graphify spread) when/if pursued.

9. **Graphify = prior art + baseline, not a dependency** — final name must avoid collision with it.
   It's the concrete embodiment of the "single global strategy" we improve on, and our evaluation
   baseline.

10. **Spec-driven with Kiro, one phase at a time** — requirements → design → tasks, each approved
    before coding. Steering = durable why; PROJECT_STATE = live where; specs = the plan. Diary and
    research log are AI-maintained from REAL work only.

---

## Setup history (done)

Workspace reorganized (`tooling/`, `docs/reference/`, `archive/`); nested `.git` repos removed from the
MCP servers; backbone generated (steering + state ledger + AGENTS + doc seeds + root config + folder
spine); core spec renamed Graphify → RepoHIVE. Current status and next action: see `PROJECT_STATE.md`.
