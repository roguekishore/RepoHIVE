# BRAIN — RepoHIVE Persistent Memory Log

> **What this is.** An append-only memory of the project: every meaningful session, decision,
> correction, and outcome, in time order. It is the project's long-term history so context is never
> lost between sessions or after context resets.
>
> **Rules for maintaining it:**
> - **Append, never delete.** New entries go at the BOTTOM. Past entries are history — do not edit or
>   remove them, even if a decision is later reversed (instead, add a new entry recording the reversal).
> - Each entry: date, what happened, why, and any decision/outcome. Keep entries terse.
> - Record only REAL events (work done, decisions made, feedback received) — never speculation.
> - **Timestamps must be the real system date+time in 24-hour format** — run
>   `Get-Date -Format 'yyyy-MM-dd HH:mm'` first and stamp each entry with the full `YYYY-MM-DD HH:mm`.
>   NOT the conversation's start date. A single conversation can span many real days/times; always verify.
> - This complements, not replaces: `PROJECT_STATE.md` = current snapshot; `PROJECT_PLAN.md` =
>   decisions + rationale; `BRAIN.md` = the running history of how we got here.
>
> **Read order for an agent:** PROJECT_STATE (now) → steering/ (durable context) → BRAIN (history,
> when deeper context is needed).

---

## How to add an entry (template)

```
### YYYY-MM-DD — <short title>
- **What:** what happened this session.
- **Why:** the reasoning / trigger.
- **Decision/Outcome:** what was decided or produced.
- **Next:** what this sets up (optional).
```

---

## History

> **Date-accuracy note (added 2026-07-01):** entries below originally dated "2026-06-22" were written
> across a multi-day conversation that began 2026-06-22; the real dates of later entries drifted up to
> ~2026-07-01. Dates are approximate for that early span. Going forward, every entry uses the verified
> system date.

### 2026-06-22 — Project setup and planning
- **What:** Long planning conversation; set up the entire project backbone from the existing docs
  (project brief, Zeroth Review deck v3, core grouping spec).
- **Why:** Establish durable context so minimal daily time is spent re-explaining; enable AI-driven,
  spec-driven development across 6 reviews + a paper.
- **Decision/Outcome:**
  - Stack: TypeScript/Node, Tree-Sitter, graphology, Louvain/Leiden, React+React Flow, JSON storage,
    npm workspaces. MySQL removed; Neo4j deferred to 8th sem.
  - Core contribution: adaptive per-region preserve-vs-reconstruct hierarchy, deterministic.
  - Embeddings deferred (search/naming only, never grouping). Cloud/auth not needed for core.
  - Graphify researched (63k-star prior art, single global Leiden, no embeddings) → it's our baseline
    and validates the no-embeddings call. Edge narrowed to: adaptive multi-level hierarchy + determinism.
  - Path 1 (degree + paper) chosen; Path 2 (viral) deferred, architecture kept open. Skill = top
    distribution lever later.
  - Generated: 8 steering docs, PROJECT_PLAN (index+decisions), PROJECT_STATE (ledger), AGENTS.md,
    research-log + project-diary seeds, root config, packages spine.
  - Workspace reorganized: tooling/ (MCP servers), docs/reference/, archive/. Nested .git repos
    removed from the MCP servers. mcp.json paths updated.
  - Optimization pass: PROJECT_PLAN slimmed from a steering-duplicate into an index + decision log
    (single source of truth = steering).
- **Next:** Review 1 (Parser, due 03.07.2026).

### 2026-06-22 — Name finalized: RepoHIVE
- **What:** Brand name chosen and applied across all docs/files (was placeholder "FlowGraph").
- **Why:** Needed a final, distinct identity that avoids collision with Graphify.
- **Decision/Outcome:** **RepoHIVE** = Repository Hierarchical Indexing & Visualization Engine. Command
  names (`parse`/`group`/`view`) remain placeholders. npm name `repohive`; demo references updated.

### 2026-06-22 — Zeroth Review handout produced
- **What:** Created a one-page jury handout (md → docx → pdf via Word MCP).
- **Why:** Give the panel a crisp, professional grasp of the project.
- **Decision/Outcome:** Formal register, sections Problem→Objective→Technical Approach→Contribution→
  Outcomes→Phase-I Plan. An "Existing Systems/Gap" variant was tried then reverted per request.

### 2026-06-22 — Review 1 parser requirements drafted
- **What:** Created `.kiro/specs/dependency-graph-parser/requirements.md` (10 requirements, EARS style,
  matching the core spec's rigor). Also created `REVIEW1_KICKOFF.md` (spec-creation instructions).
- **Why:** Review 1 deliverable is the parser (Java repo → graph.json).
- **Decision/Outcome:** Reviewed and confirmed faithful to plan — scoped to parser only, ASTs transient,
  frequency signals start simple (shape correct day one), deterministic, contract-conforming.
- **Next:** design.md → tasks.md for the parser (pending approval to proceed).

### 2026-07-01 — Documented untracked UI experiments + fixed date drift
- **What:** Found 6 undocumented UI explorations in `ui-ideas/` (demoapp, landing1 "Aeon", landing2,
  landing4, portal, prisma) built during prior UI sessions but never recorded. Added `ui-ideas/README.md`
  inventorying them. Also discovered BRAIN/STATE date entries were stamped with the conversation's start
  date (2026-06-22) instead of the real date (system date is 2026-07-01).
- **Why:** User flagged that built work wasn't being tracked and that timestamps were wrong because the
  same conversation continues across multiple real days.
- **Decision/Outcome:**
  - `ui-ideas/` declared experimental scratch space (NOT product; not wired into the engine). Only
    `demoapp/` is RepoHIVE-themed; others are layout/animation references (some unrelated themes).
  - Added a standing rule (AGENTS.md + BRAIN.md): always run `Get-Date` for the real date before
    stamping; always document newly created artifacts in PROJECT_STATE + a folder README.
  - Did NOT rewrite past entries (append-only); added a date-accuracy note instead.
- **Next:** Decide later which UI idea (if any) becomes the basis for `packages/web`.

### 2026-07-01 — Reviewer/Explainer agent created (self-contained)
- **What:** Created the `reviewer-explainer` custom agent (`.kiro/agents/reviewer-explainer.md`) — a
  read-and-explain agent that translates specs/product phases into plain language for the owner. Folded
  the explanation knowledge (analogies, jargon translations, honest-framing rules, owner context, 7-step
  spec-readout structure) directly into the agent and deleted the standalone `reviewer-guide.md`.
- **Why:** Owner wanted the human-level explanation knowledge to survive chat loss, and preferred one
  self-contained agent file over an agent + a loose md the agent merely points at.
- **Decision/Outcome:** Agent reads PROJECT_STATE → steering → BRAIN → the target spec, then explains.
  Knowledge now lives inside the agent; nothing dangling. Invoke it whenever a spec/phase needs a plain
  explanation or an honest "does this match the plan" check.

### 2026-07-01 — Parser implemented end-to-end (Review 1 deliverable)
- **What:** Completed the `dependency-graph-parser` spec (`design.md` + `tasks.md`) and executed all 16
  tasks. Built `packages/shared` (JSON-contract types: GraphNode, DependencyEdge, RawDependencyGraph)
  and `packages/parser` — the full pipeline: input validation → recursive `.java` collection →
  Tree-Sitter (web-tree-sitter + tree-sitter-java WASM) AST extraction of file/class/function nodes →
  symbol-table construction → cross-file stitching into de-duplicated directed import edges + the three
  frequency signals (importFrequency counted; methodCall/sharedType at Phase-1 zero) → canonical
  stable-stringify serialization → atomic write → `parseProject` orchestrator with an error gate (no
  partial output). Content-derived IDs + canonical ordering give determinism.
- **Why:** Review 1 (03.07.2026) deliverable is the parser producing `graph.json`.
- **Decision/Outcome:**
  - 102/102 tests pass (fast-check property tests for determinism, contract conformance, edge
    uniqueness, no self/function edges, symbol collision determinism; plus example/unit tests).
  - Added `fixtures/sample-java-project/` (hand-written, multi-package, nested/inner types, overloads,
    cross-file imports) → 29 nodes / 5 edges; checked in so the determinism digest is stable.
  - Added `verifyDeterminism` harness + `npm run demo:determinism` (parses N times, asserts identical
    SHA-256 — got `51bfd2f3…`).
  - Added a single-command demo wrapper `npm run parse -- <dir>` (root script → parser `parse-cli.ts`,
    resolves relative paths against `INIT_CWD`). **This wrapper is temporary demo convenience — must be
    reverted/replaced when the packaged CLI lands in 8th sem (per architecture engine-vs-ecosystem line).**
  - Git still not initialized; generated `graph.json` must stay git-ignored (to verify before first commit).
- **Next:** Review 1 demo prep; initialize git (phase-1-parser branch, `review-1` tag).

### 2026-07-01 — Automated documentation hooks created
- **What:** Created three Kiro hooks in `.kiro/hooks/`: (1) `sync-docs-on-stop` (agentStop → update
  PROJECT_STATE + append BRAIN after meaningful work); (2) `track-new-artifacts` (fileCreated for
  ts/tsx/js/package.json/md → ensure new packages/experiments get a folder README + STATE note);
  (3) `log-task-completion` (postTaskExecution → record spec-task completion).
- **Why:** Manual documentation discipline was failing — parser files and the 6 ui-ideas experiments
  appeared without PROJECT_STATE/BRAIN being updated. Hooks automate it via IDE events.
- **Decision/Outcome:** Documentation now fires automatically on turn-end, file-creation, and
  task-completion. Caveat: agentStop runs a follow-up doc pass each session; hooks ask an agent (judge
  "was this meaningful?"), so quality depends on prompt-following — more reliable than memory, not infallible.
- **Next:** Reconcile PROJECT_STATE with parser build files already present (`packages/parser/src/`).

### 2026-07-04 — Expanded sync-docs hook to cover diary + research log
- **What:** Updated `.kiro/hooks/sync-docs-on-stop.kiro.hook` (v1 → v2) with explicit instructions for
  all four docs.
- **Why:** The hooks only touched PROJECT_STATE + BRAIN; diary and research-log were untracked.
- **Decision/Outcome:** PROJECT_STATE + BRAIN remain AUTO-updated. research-log and project-diary are
  now DRAFT-FOR-APPROVAL only (never silently written): research-log drafted in the owner's own voice +
  paraphrased (0%-plagiarism protection); diary drafted at most once per real work day with a
  duplicate-row check and no backfilling empty days. Rationale: these two are academic, human-owned,
  plagiarism-sensitive artifacts.
- **Next:** Pending — reconcile git branches (parser work still uncommitted on main vs phase-1-parser).

### 2026-07-04 11:45 — Switched logging to 24-hour timestamps
- **What:** Updated `sync-docs-on-stop` and `log-task-completion` hooks, plus the BRAIN and AGENTS
  rules, to stamp entries with real date+time in 24-hour format via `Get-Date -Format 'yyyy-MM-dd HH:mm'`.
- **Why:** Owner wants time-of-day logging (24-hour) on entries going forward, not just the date.
- **Decision/Outcome:** BRAIN entries now carry full `YYYY-MM-DD HH:mm` timestamps; STATE decision-log
  and diary rows may use date alone. Prior entries left unchanged (append-only).
- **Next:** Pending git branch reconciliation (parser work uncommitted across main/phase-1-parser).
