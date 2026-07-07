---
inclusion: always
---

# Task Documentation & Memory Workflow

Two stores, never mixed:
- `.kiro/` = how Kiro behaves: specs, steering, hooks, agents, skills, MCP config.
- External vault (Basic Memory project `personal`, at `D:\Vaults\personal-brain`, browsed in Obsidian) = what you know and produce: durable knowledge, per-task narrative, decisions, test matrix, diagrams, delivery hand-off.

Memory tool: the `basic-memory` MCP is bound to `--project personal`. Use it (`search_notes`, `read_note`, `build_context`, `write_note`, `edit_note`, `recent_activity`) to recall and record. At the start of any non-trivial task, search memory first for related tasks, decisions, and knowledge.

Two helpers ship as skills (IDE) and agents (CLI): `task-researcher` and `handoff-generator`. In the IDE, invoke them as skills.

## Vault separation
Keep this personal vault separate from any other vault (e.g. the company `desk365` vault). Never write personal content into another project's vault or vice versa. This workspace's memory MCP is bound to `--project personal`.

## Per-task flow
A tracked item is one work item; its type is by effort: epic/feature, story, task, bug (adjust to your tracker). RepoHIVE has no external tracker — the delivery axis is a paste-ready breakdown doc (see the hand-off section).
1. Create a Kiro spec at `.kiro/specs/<slug>/` (`requirements`/`design`/`tasks`) — the build backbone.
2. Create a vault task-record in `tasks/` from `templates/task-record.md`; link the spec in frontmatter.
3. Keep the NARRATIVE axis in the record: Intake -> Discovery -> Decisions (ADRs in `decisions/`) -> Complications & Branches -> Implementation -> Verification.
4. A hurdle that becomes its own item -> new task-record, linked via `parent`/`branches`.
5. Maintain a developer test-matrix from `templates/test-matrix.md` — required before Close.

Use the `task-researcher` skill to populate Discovery with real file/method references.

## Hand-off (paste-only)
The delivery axis is the work-item shape (item type + phases). Do not restructure the vault to match it. The `handoff-generator` skill projects the narrative onto the delivery tree using `templates/work-item-format.md` (the configurable contract — never hardcode phases). RepoHIVE has no external tracker with a write API, so the hand-off is a paste-ready/breakdown doc; skip the id read-back step.

## Diagrams
Author as mermaid inside the record; export to PNG for attaching.

## Lifecycle actions (on request)
A SessionStart hook loads recent memory automatically. Trigger the rest conversationally:
- **Start task `<id> [type]`** — create the spec + a `tasks/` record (id/title/item_type/status=intake, link the spec), search memory, then invoke the `task-researcher` skill for Discovery.
- **Log decision `...`** — add an ADR in `decisions/` from `templates/adr.md`; link it under the record's Decisions.
- **Generate / refresh hand-off** — invoke the `handoff-generator` skill; export mermaid diagrams to PNG.
- **Close task `<id>`** — verify a `test-matrix` exists (block if missing), finalize the hand-off, write durable learnings to `knowledge/`, set `status: done`, update `00-index`.

## Relationship to RepoHIVE's existing project memory
This workflow is additive and does NOT replace RepoHIVE's academic project-memory system (`.kiro/PROJECT_STATE.md`, `.kiro/BRAIN.md`, `docs/research-log.md`, `docs/project-diary.md`, and the sync-docs hooks). Those remain the source of truth for review/paper progress. The Basic Memory vault is the per-task narrative + durable knowledge store that sits alongside them.
