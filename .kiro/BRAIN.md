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

### 2026-07-04 12:23 — Documented the RepoHIVE commit convention
- **What:** Expanded `steering/git-workflow.md` with the real commit convention learned from history:
  product-code types (`feat/fix/test/refactor/chore`) vs the `kiro(...)` meta type (specs, hooks,
  agents, docs, project-memory). Added scopes list, one-commit-per-task target, and a docs/logs/state
  commit policy (commit memory files on `main` in their own commits, not on feature branches).
- **Why:** Owner leans toward a `kiro()` convention and wants a doc the (future) commit hook can
  reference for best practices. Learned the convention by reading recent git log.
- **Decision/Outcome:** Convention documented. STILL PENDING (owner to confirm): a commit-assist hook.
  Recommended a **userTriggered commit-assist** (detect meaningful changes → propose conventional
  commits → commit on confirmation) over per-task auto-commit, because "run all tasks" is unattended
  and conflicts with "commit on my confirmation"; also `postTaskExecution` firing-per-task during a
  batch run is uncertain.
- **Next:** Owner to confirm the commit-hook approach; then build it referencing git-workflow.md.

### 2026-07-04 12:27 — Created Commit Assist hook (userTriggered)
- **What:** Added `.kiro/hooks/commit-assist.kiro.hook` — a manually-triggered hook that reads
  git-workflow.md, inspects uncommitted changes, groups them logically, proposes conventional commit
  messages (feat/fix/test vs kiro), flags risks, and commits ONLY on user confirmation (never push).
- **Why:** Owner wants per-task commits but triggers work via unattended "run all tasks"; a
  user-triggered assistant reconciles "commit granularly" with "commit on my confirmation" and avoids
  reliance on postTaskExecution firing per-task during a batch.
- **Decision/Outcome:** Chose userTriggered commit-assist over postTaskExecution auto-commit.
- **Next:** Owner to decide whether to keep or remove the now-redundant `log-task-completion` hook.

### 2026-07-06 23:28 — Basic Memory task-documentation + memory system replicated in `.kiro/`
- **What:** Executed a self-contained handoff prompt to stand up the task-documentation + memory
  system (first built in a company repo) here in RepoHIVE, adapted to this project. Created:
  `.kiro/steering/task-workflow.md` (inclusion: always); skills
  `.kiro/skills/task-researcher/SKILL.md` (its `## Repo architecture` section rewritten for RepoHIVE's
  TS/Node monorepo — shared/parser/core/cli/web, no DB) and `.kiro/skills/handoff-generator/SKILL.md`;
  CLI agents `.kiro/agents/{task-researcher,handoff-generator}.json` (exact 7-key shape,
  model=claude-sonnet-4, JSON validated); and a SessionStart hook
  `.kiro/hooks/load-memory-on-start.json` (runs `bm tool recent-activity --project personal`).
  Synced the external `personal` vault (`D:\Vaults\personal-brain`) by briefly starting/stopping
  `bm mcp --project personal` → `bm status` now "No changes" (embedding model already cached).
- **Why:** Add per-task narrative + durable-knowledge capture (Basic Memory, browsed in Obsidian)
  alongside RepoHIVE's existing academic memory. Vault is separate from the `desk365` company vault.
- **Decision/Outcome:** System is ADDITIVE, not a replacement for PROJECT_STATE/BRAIN/diary/research-log.
  Two items left for the owner: (1) `.kiro/settings/mcp.json` is write-protected for the agent, so the
  owner must paste the `basic-memory` MCP entry and reload the window; (2) the vault's Zoho-flavored
  `work-item-format.md` contract was deliberately NOT edited — owner to choose keep-as-is vs adapt to an
  academic review-driven shape. Agents are CLI-only (IDE path is skills). Obsidian Dataview plugin
  needed for the vault boards.
- **Next:** Owner pastes the MCP config + picks the contract option; then dry-run "start task &lt;id&gt;".

### 2026-07-07 00:35 — Purged all tracker vocabulary (sprints + Zoho) from the vault templates
- **What:** Owner clarified RepoHIVE has NO sprint concept, ever; then (seeing leftover `zoho-handoff`
  and `DE-Ixxxx` nodes in the Obsidian graph) asked to remove the remaining tracker references too.
  Two passes on the `personal` vault templates: (1) removed all "sprint" wording; (2) full
  de-Zoho/de-DE-Ixxxx pass — rewrote `task-record.md`, `adr.md`, `test-matrix.md`,
  `work-item-format.md` (stripped Zoho/DE-Ixxxx, generic `<id>` placeholders, `format_version` 1→2),
  renamed `zoho-handoff.md` → `handoff.md` (old deleted), fixed the `00-index` link. Verified zero
  `zoho`/`DE-Ixxxx`/`sprint` matches remain in the vault or in `.kiro/`. Re-synced Basic Memory (No changes).
- **Why:** RepoHIVE is academic/review-driven with no external tracker; the vault templates were
  inherited Zoho/agile-flavored and polluted the graph. This completes the Task-10 "adapt the contract" work.
- **Decision/Outcome:** Kept the delivery structure (item_types epic/story/task/bug + 6 phases) but
  de-branded it. Two generic placeholder ghost nodes remain (`<task-record>`, `<parent record>`) —
  inherent to templates; recommended hiding `templates/` via the Obsidian graph filter `-path:templates`.
  Offered the owner the option to also drop the agile item-types/heavier phases for a lighter academic set.
  (Native fs tools work on the external vault for edit/create/read, but delete does not — used PowerShell to delete.)
- **Next:** Owner to (a) paste the `basic-memory` mcp.json entry + reload; (b) decide on item-types/phases
  simplification; (c) optional graph-filter tweak. Then the memory system is ready for a first "start task" dry run.

### 2026-07-07 11:15 — Recorded full decision history to the personal vault + fixed memory-MCP binding
- **What:** Found the `basic-memory` MCP was bound to the company `desk365` project (the user-level
  config had a stray `--project desk365 personal` arg, so it resolved to desk365), and that a prior
  session's claimed "28 vault notes" were never actually persisted — the external vault's `decisions/`
  and `knowledge/` were empty. After the owner added a workspace-level `.kiro/settings/mcp.json` override
  binding this workspace to `personal` (verified: reports `Project: personal`), recorded RepoHIVE's full
  decision history into the vault via the MCP: 17 ADRs (`decisions/ADR-001..017`) + 14 knowledge notes
  (`knowledge/`), all cross-linked with wikilinks and anchored to `RepoHIVE Overview`.
- **Why:** The earlier vault task was never truly complete, and writing through a desk365-bound MCP would
  have contaminated the company vault. The raw planning chat is compacted, so notes were reconstructed
  from the project's own records (PROJECT_PLAN decision log, BRAIN history, steering) — not invented.
- **Decision/Outcome:** MCP bound to `personal` via a workspace override (keeps `desk365` the global
  default). 31 notes created. No ADR marked superseded — reversals recorded inline (e.g. ADR-013 folded
  the reviewer-guide into a self-contained agent). Trivial items (24h-timestamp rule, temporary parse
  wrapper, cohesion/coupling rationale) folded into knowledge notes, not ADRs.
- **Next:** Owner to run `bm sync` on the vault to finalize forward-reference wikilinks + permalinks;
  optionally simplify the vault contract's item_types/phases; then resume the Review 2 `packages/core` build.

### 2026-07-07 11:31 — Reworked project-diary handling (weekly, implementation-only, auto)
- **What:** Restructured `docs/project-diary.md` into a weekly implementation log (Week | Dates start-end |
  Implementation work | Supervisor Sign) with placeholder date ranges, seeded Week 1 with the Phase-1
  parser. Rewrote item 6 of both `sync-docs-on-stop` hook files (`.json` + `.kiro.hook`) so the diary is
  auto-maintained, weekly, and implementation-only — explicitly excluding meta work (hooks, steering,
  vault, PROJECT_STATE/BRAIN, git, agent/MCP config, naming). Dropped the old meta "setup" diary row and
  the planning-only weekly note.
- **Why:** Owner flagged the diary kept lagging (unlike STATE/BRAIN) and wanted it reviewer-facing,
  implementation-only, weekly, with owner-fixated week date ranges.
- **Decision/Outcome:** Diary moved from draft-for-approval to AUTO (refines ADR-014); research-log
  remains the only approval-gated doc. Modified the existing hook rather than adding a separate one
  (avoids a second agent pass per turn-end). Both hook files validate (no diagnostics). May need a
  window reload to load the new hook.
- **Next:** Owner to fixate the Week-1 date range; optionally confirm keep-diary-auto vs revert to
  draft-for-approval. Resume Review 2 (`packages/core`) build.
