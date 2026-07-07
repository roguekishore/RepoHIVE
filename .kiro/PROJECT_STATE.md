# Project State — RepoHIVE

> **READ THIS FIRST every session.** Live progress ledger. Update it after meaningful work.
> For decision rationale see `PROJECT_PLAN.md`; for canonical operational context see `.kiro/steering/`.

---

## Current position

- **Phase:** Review 2 — core grouping algorithm (not yet started; `packages/core` is empty).
- **Recently done:** Review 1 parser complete (`packages/shared` + `packages/parser` → `graph.json`,
  102 tests) per BRAIN 2026-07-01. Earlier (2026-07-06): stood up the **Basic Memory
  task-documentation + memory system** in `.kiro/`. (2026-07-07 11:xx): fixed the memory-MCP binding
  and recorded the full decision history to the `personal` vault (17 ADRs + 14 knowledge notes).
  Latest (2026-07-07 13:20): re-verified the Review 1 parser end-to-end (build + 102 tests + both
  demo scripts) and wrote `docs/1st/review-1-demo-guide.md` for the Review 1 presentation.
- **Next review:** Second Review — **15.07.2026** — deliverable: **algorithm** (`group` → `index/`).
- **Next action:** **Owner will perform the `phase-1-parser` → `main` merge, `review-1` tag, and
  `phase-2-core` branch themselves** (git milestone ops are owner-driven — an agent-run merge was
  reverted 2026-07-07 14:01; nothing was pushed). Parser confirmed solid for Review 2. Then write
  `hierarchical-repository-grouping/tasks.md` (currently empty) and implement `packages/core`
  (adaptive preserve-vs-reconstruct grouping → `index/`).

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
- [x] **Review 1 parser complete** (`packages/shared` + `packages/parser`; Tree-Sitter Java →
      `graph.json`; determinism harness; 102 tests) — per BRAIN 2026-07-01.
- [x] **Basic Memory task-documentation + memory system** set up in `.kiro/` (2026-07-06):
      `steering/task-workflow.md`; skills `task-researcher` + `handoff-generator` (`.kiro/skills/`);
      CLI agents `.kiro/agents/{task-researcher,handoff-generator}.json`; SessionStart hook
      `load-memory-on-start.json`. Backed by the external `personal` vault (`D:\Vaults\personal-brain`).
- [x] **Decision history recorded to the `personal` vault** (2026-07-07): 17 ADRs + 14 knowledge notes
      written via the basic-memory MCP (after binding it to `personal`). A prior session's notes were
      never persisted, so the set was regenerated from PROJECT_PLAN + BRAIN + steering.
- [x] **Review 1 parser re-verified end-to-end** (2026-07-07): `npm run build` clean;
      `npm test --workspace @repohive/parser` → 102/102 passing; `npm run parse` against
      `fixtures/sample-java-project` (29 nodes/5 edges) and `fixtures/vantage` (803 nodes/128 edges);
      `demo:determinism` → identical SHA-256 across 3 runs. Wrote
      `docs/1st/review-1-demo-guide.md` (commands + real captured output) for the Review 1
      demonstration, plus `docs/1st/README.md`.

## In progress

- Review 2 (core algorithm): `hierarchical-repository-grouping` spec has requirements + design;
  `tasks.md` is empty and `packages/core` is unbuilt.
- **Awaiting owner:** (1) DONE 2026-07-07 — `basic-memory` MCP now bound to `personal` via a
  workspace-level `.kiro/settings/mcp.json` override (verified: reports `Project: personal`); (2) optional:
  simplify the contract's agile item_types/phases to a lighter academic set (the de-tracker/de-Zoho pass
  itself is done); (3) optional: hide `templates/` from the Obsidian graph; (4) run `bm sync` on the vault
  to finalize wikilink resolution + permalinks.

## Next up (Review 1 — Parser)

- [ ] `dependency-graph-parser` spec: requirements → design → tasks.
- [ ] `packages/shared`: JSON-contract types (GraphNode, DependencyEdge, etc.).
- [ ] `packages/parser`: Tree-Sitter Java → stitch → `graph.json`.
- [ ] Pick a small open-source Java repo as `fixtures/sample-java-project`.

## Known gaps / open questions

- **Parser produces the graph that the core algorithm consumes** — must target the existing spec's
  exact schema. (Resolved decision; flagged here as a reminder during build.)
- Frequency signals (import/call/shared-type) start simple; sharpen later.
- Final project name **RepoHIVE** locked; command names still TBD (placeholders in use).
- **Git IS initialized** (13+ commits, `origin` remote, `main` + `phase-1-parser` branches) — the
  "git not yet initialized" line above and in `steering/git-workflow.md` is stale and should be
  corrected. Flagged 2026-07-07, not yet fixed.
- **Review 1 work not merged to `main` / not tagged.** All parser commits live on `phase-1-parser`
  (pushed to origin); `main` is still pre-parser. Per `git-workflow.md`, review-ready work should
  merge to `main` and get a `review-1` tag — owner has not yet requested this.
- **No vault task-record for the parser work** — it was built (2026-07-01) before the Basic Memory
  system existed (2026-07-06), so it has no `tasks/` narrative/test-matrix, only BRAIN/STATE entries.
- Project diary team/date placeholder fields (`Team No.: _____`, week date ranges) still unfilled —
  fine for internal use, needed before physical submission.

---

## Decisions log (most recent first)

- **2026-07-07** — Process correction: **git milestone operations (merge to `main`, tags, phase
  branches) are owner-driven, not agent-driven.** An agent-performed `phase-1-parser` → `main`
  `--no-ff` merge + `review-1` tag + `phase-2-core` branch (all local, never pushed) was fully
  reverted at the owner's request — `main` and `phase-1-parser` restored to their `origin` refs,
  tag and branch deleted, `docs/1st` + memory edits preserved as uncommitted changes. The owner
  had only asked whether the parser features were solid to proceed (answer: yes), not for the merge.
- **2026-07-07** — Re-verified the Review 1 parser end-to-end on request (build, 102 tests, both demo
  scripts, a real third-party repo parse) rather than trusting prior BRAIN entries alone, and produced
  a Review 1 demonstration guide (`docs/1st/review-1-demo-guide.md`) with real captured command output
  for use at the 03.07.2026 review. Surfaced but did not act on: unmerged `phase-1-parser` branch (no
  `main` merge / `review-1` tag yet), a stale "git not initialized" line in steering/STATE, and blank
  project-diary submission placeholders — left for the owner to decide on.
- **2026-07-07** — Reworked project-diary handling: the diary is now AUTO-maintained, WEEKLY, and
  IMPLEMENTATION-ONLY (product/engine code + specs only; meta/infrastructure excluded), moving it from
  draft-for-approval to auto — refines ADR-014 (research-log stays the only approval-gated doc).
  Restructured `docs/project-diary.md` into a weekly implementation log (placeholder date ranges for the
  owner to fixate) seeded with Week 1 = Phase-1 parser; rewrote item 6 of both `sync-docs-on-stop` hook
  files. Chose to modify the existing hook rather than add a second Stop hook.
- **2026-07-07** — Bound this workspace's `basic-memory` MCP to the `personal` project via a workspace-level
  `.kiro/settings/mcp.json` override (the user-level config was misbound to `desk365` by a stray arg),
  keeping `desk365` as the global default. Recorded RepoHIVE's full decision history into the external
  `personal` vault — 17 ADRs (`decisions/`) + 14 knowledge notes (`knowledge/`) — via the basic-memory MCP.
  Found a prior session's claimed "28 notes" were never persisted (vault folders empty) and regenerated
  from PROJECT_PLAN + BRAIN + steering.
- **2026-07-07** — Completed the Task-10 de-tracker adaptation: full de-Zoho/DE-Ixxxx pass on the vault
  templates (rewrote task-record/adr/test-matrix/work-item-format; renamed `zoho-handoff.md` →
  `handoff.md`; fixed the `00-index` link; contract `format_version` 1→2). Kept the delivery structure,
  de-branded it; vault + `.kiro/` verified free of zoho/DE-Ixxxx/sprint. Open: optionally simplify the
  agile item_types/phases to a lighter academic set.
- **2026-07-06** — Scope clarification: **RepoHIVE has no "sprint" concept, ever.** Removed all sprint
  references from the Basic Memory vault templates (`task-record.md`: dropped `sprint:` frontmatter,
  "sprint item" → "work item", `[[Epic or Sprint]]` → `[[Parent work item]]`; `work-item-format.md`:
  "Zoho Sprints tree" → "delivery tree"). The `.kiro/` machinery I created never used sprints.
  Remaining Zoho/DE-Ixxxx tracker language in the templates is left pending the Task-10 keep-vs-adapt call.
- **2026-07-06** — Replicated the AI task-documentation + memory system (from a company repo) into
  RepoHIVE's `.kiro/`, adapted to this project: steering `task-workflow.md`, skills
  `task-researcher`/`handoff-generator`, CLI agents (JSON, 7-key shape), and a SessionStart
  `load-memory-on-start` hook over the external Basic Memory `personal` vault. Additive to (not a
  replacement for) PROJECT_STATE/BRAIN/diary/research-log. Vault contract `work-item-format.md` left
  Zoho-flavored pending an owner keep-vs-adapt decision; `.kiro/settings/mcp.json` edit deferred to
  the owner (agent write-blocked).
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
