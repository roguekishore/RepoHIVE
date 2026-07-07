---
name: handoff-generator
description: Use when generating or refreshing a delivery hand-off for a task, or reading assigned ids back into the vault. Projects a personal vault task-record onto the configurable work-item-format contract and emits a paste-ready nested tree (item type by effort, phases per item). Triggers include "generate hand-off", "refresh hand-off", or closing a task.
alwaysApply: false
globs:
---

# Hand-off Generator

Turn a task's vault narrative into a paste-ready delivery tree. Format-agnostic (structure comes from the contract file) and paste-only (never auto-create in a tracker).

## Two axes
- Vault = narrative (Intake, Discovery, Decisions, Complications, Implementation, Verification) — the source; never restructure it.
- Delivery = the work-item shape (item type by effort + phase set per item) — what you project onto.

## Step 1 — read the contract (always)
Read `D:\Vaults\personal-brain\templates\work-item-format.md` and parse its fenced `yaml` block: `item_types` (with `use_when`), `nesting`, `phases` (ordered; id/title/sources/outline; may nest via `children`), `format_version`. This is the only source of structure. Never hardcode phase names.

## Step 2 — read the task
- The task-record under `tasks/` (basic-memory `read_note`/`search_notes` or read the file).
- Its `test-matrix` note and linked `decisions/` ADRs.
- The Kiro spec at the record's `spec:` path (requirements/design/tasks), if any.

## Step 3 — propose decomposition
Choose item type(s) by effort via `use_when`; nest if large. Present the tree and get confirmation before writing.

## Step 4 — apply phases
For every node, apply the full `phases` set, filling each phase's description from its `sources` tokens shaped by its `outline` (`spec:*` -> spec files; `vault:*` -> record sections; `vault:test-matrix` -> the matrix; `diagrams` -> mermaid PNGs; `pr` -> PR link). Write clean, self-contained text.

## Step 5 — write the hand-off
Write `tasks/<id>/handoff.md` as a nested outline mirroring the tree: per node a heading `<type>: <title>`, a paste block, then a sub-block per phase. Stamp `format_version` + date.

## Step 6 — diagrams to PNG
Export the task's mermaid diagrams to PNG under `tasks/<id>/diagrams/` (mermaid MCP if available, or `npx -y @mermaid-js/mermaid-cli -i in.mmd -o out.png`).

## Step 7 — id read-back (only if your tracker has a read API/MCP)
RepoHIVE has no external tracker, so this step is normally skipped. If a tracker is ever added and its items exist there, fetch them read-only and map assigned ids back into this file and the record frontmatter.

## Hard rules
- Format-agnostic: the contract is the only source of structure.
- Paste-only: never auto-create in a tracker.
- Confidentiality/separation: operate only on the `personal` vault.
- Faithful: every phase traces to real record/spec content; empty source -> mark "not yet available".
