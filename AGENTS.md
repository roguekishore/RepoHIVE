# AGENTS.md — RepoHIVE

> Front door for any AI agent working on this project. Read this, then the files it points to.

## Read order (every session)

1. **`.kiro/PROJECT_STATE.md`** — where we are right now + the next action. **Read first.**
2. **`.kiro/steering/`** — durable context (auto-loaded by Kiro):
   `product.md`, `architecture.md`, `tech-stack.md`, `performance-and-scale.md`,
   `competitive-landscape.md`, `roadmap.md`, `review-timeline.md`, `git-workflow.md`.
3. **`.kiro/PROJECT_PLAN.md`** — index into steering + the decision log (the *why* behind each choice).
4. **`.kiro/specs/`** — per-phase specs (requirements → design → tasks).

## The project in five lines

- A hierarchical codebase indexing engine: flat dependency graph → multi-level hierarchy
  (Repository → Groups → Files → Functions).
- Core contribution: **adaptive, per-region** preserve-vs-reconstruct construction, **deterministic**.
- Pipeline: `parse` (Java repo → graph.json) → `group` (→ index/*.json) → `view` (interactive viewer).
- Final-year project across 2 semesters / 6 reviews + a 0%-plagiarism paper.
- **RepoHIVE** (Repository Hierarchical Indexing & Visualization Engine) is the **final** name;
  `parse`/`group`/`view` command names are placeholders, not final.

## Rules of engagement

- **Spec-driven:** requirements → design → tasks, each approved before coding. One phase at a time.
- **Engine vs ecosystem:** keep every change on the right side of the line (see `architecture.md`).
- The **JSON contract** is the stable seam — don't break it.
- **Honesty over hype:** estimates labeled as estimates; claims must be defensible (see the caveats
  in `product.md`). Don't claim "71x" or "better than Sourcegraph overall."
- **Git:** do NOT run git commands unprompted; it's not yet initialized (see `git-workflow.md`).
- **Diary/research log:** record only REAL work; never fabricate progress.
- After meaningful work, **update `.kiro/PROJECT_STATE.md`**.

## Tooling available

- Filesystem MCP, PDF reader MCP, Word + PPT MCP servers (in `tooling/`, used for docs/decks).
