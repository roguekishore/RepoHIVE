# AGENTS.md

Front door for any AI agent or new contributor working in this repository. This file is the canonical
entry point and is tool-neutral. Editor-specific files (for example `CLAUDE.md`) only add what is specific
to that editor.

## What this project is

RepoHIVE turns a flat dependency graph into a navigable multi-level hierarchy: Repository, Groups, Files,
Functions. Rather than imposing one grouping strategy everywhere, it measures each region's structural
quality and decides **per region** whether to preserve the existing package boundaries or reconstruct them
by community detection. Every decision is recorded, and identical input produces byte-identical output.

Pipeline: `parse` (Java sources to `graph.json`), then `group` (to the five-file `index/` contract), then
`view` (the hierarchical viewer).

## Two repositories

Durable engineering rules are tracked here under `docs/engineering/`. Project state and decisions live in
`context/`, a separate private repository cloned into this checkout and git-ignored. It is optional: a
clone without it builds, tests and runs normally.

Because `context/` is git-ignored, ripgrep-backed search skips it silently. **Read its files by explicit
path.**

## What to read

**Always, and only this:** `context/STATE.md`. If it is missing, the mount is absent; continue from the
code and `docs/engineering/`, and say so in your report.

**On demand, when the task touches the area:**

| Read | When |
|------|------|
| `docs/engineering/architecture.md` | Changing package layout, the JSON contract, or crossing the engine/ecosystem boundary |
| `docs/engineering/conventions.md` | Anything that affects group membership or output ordering (determinism) |
| `docs/engineering/stack.md` | Adding a dependency or tool, or looking up a command |
| `docs/engineering/verification.md` | Before reporting code work as done |
| `context/decisions/README.md` | Before reversing or extending an earlier choice; then open only the relevant files |
| `context/registers/*` | Only when working the specific item a register describes. Never as bulk context |

A decision marked **(corrected)** in the index carries a `Corrections since` section: read it before acting
on that decision.

**Delegated agents and workflow steps** read `context/STATE.md` plus the files named in their brief, not
this whole table. Whoever writes the brief passes the relevant facts in.

If a document disagrees with the code, **the code wins**. Fix the document in the same change.

## How to work

- **Read before writing.** Never propose changes to code you have not read.
- **Determinism is not negotiable** for anything deciding group membership.
- **Respect package boundaries.** Engine packages (`parser`, `core`, `shared`) must not import from
  ecosystem packages (`web`, `views`, `indexer`).
- **Run the gates** in `docs/engineering/verification.md` before reporting code work as done. A clean exit
  code is not evidence of success.
- **Label every timing cold or warm.** They differ by roughly eight times on this codebase.
- **Say what you did not verify.** An explicit gap is more useful than a confident guess.
- **Update state once, at the end of a work session**, per `context/README.md`. Not after every step, and
  not at all if nothing meaningful changed.

## Commits

`type(scope): summary` in both repositories: lowercase, imperative, no trailing period, under about 70
characters. One commit per observable sub-behaviour, each independently building and passing.

| Where | Types |
|-------|-------|
| This repository, code under `packages/` | `feat` `fix` `test` `refactor` `perf` `chore` |
| This repository, documentation including this file | `docs` |
| `context/` | `decision`, `state`, `register` |

**Never `git add .`** Stage explicit paths. The two repositories are independent, so a change spanning both
is two commits.

**Milestone git operations are owner-driven and must never run unprompted:** merges, tags, branch creation
or deletion, pushes, rebases, force-push, `reset --hard`, `--no-verify`. Ordinary commits are fine when
asked.

## Environment

This project runs on Linux, macOS, and Windows.

- **Shell separators:** Linux/macOS bash uses `&&`; Windows PowerShell uses `;`.
- **Working directory:** pass it as a parameter rather than using `cd` where the tool supports it.
- **Never start dev servers or watchers as blocking commands**; ask instead.
- **Real date before stamping anything**: Linux/macOS `date '+%Y-%m-%d %H:%M'`; Windows
  `Get-Date -Format 'yyyy-MM-dd HH:mm'`. A session can span days.

Use **Node 24**. Only `packages/web` declares an `engines` constraint, so nothing enforces this, and the
engine test scripts behave differently on Node 21 and later in a way that can report a false pass. See
`docs/engineering/verification.md`.
