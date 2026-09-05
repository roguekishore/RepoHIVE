# AGENTS.md

Front door for any AI agent or new contributor working in this repository. This file is the canonical
entry point and is tool-neutral. Editor-specific files (for example `CLAUDE.md`) exist only to point here.

## What this project is

RepoHIVE turns a flat dependency graph into a navigable multi-level hierarchy: Repository, Groups, Files,
Functions. Rather than imposing one grouping strategy everywhere, it measures each region's structural
quality and decides **per region** whether to preserve the existing package boundaries or reconstruct them
by community detection. Every decision is recorded, and identical input produces byte-identical output.

Pipeline: `parse` (Java sources to `graph.json`), then `group` (to the five-file `index/` contract), then
`view` (the hierarchical viewer).

## Two repositories, and why search will not find one of them

Durable engineering rules are **tracked in this repository** under `docs/engineering/`.

Project state and decision history live in **`context/`**, which is a separate private repository cloned
into this checkout and listed in `.gitignore`. It is local tooling. It is **not required to build, test, or
run this project**, and a clone without it is fully functional.

**Read `context/` files by explicit path.** Because the directory is git-ignored, ripgrep-backed search
tools (including most agent Grep and Glob implementations) skip it entirely. Search will return nothing and
will not tell you it skipped anything, so a file you never find looks identical to a file that does not
exist. Path-based reads work normally.

If `context/` is absent, work from `docs/engineering/` alone and say in your report which checks you could
not run because state was unavailable.

## Read order

| # | Path | Why |
|---|------|-----|
| 1 | `context/STATE.md` | Where the project is now, what is verified, what is next. Read first, every session |
| 2 | `docs/engineering/*.md` | Durable rules: architecture, stack, conventions, verification |
| 3 | `context/decisions/README.md` | Generated index of every decision. Load individual files as needed |

Steps 1 and 3 need the private mount. Step 2 is always available.

Rule of precedence: **if a document disagrees with the code, the code wins.** Fix the document in the same
change rather than leaving the contradiction for the next reader.

## Decisions: current does not mean uncorrected

`context/decisions/` holds one file per decision, with a generated index. The project's norm is *partial*
supersession: a later decision retracts one named constraint while the rest of the earlier decision stands.
So a file marked `status: current` may still contain a retracted constraint.

Files flagged **(corrected)** in the index carry a `Corrections since` section. Read it before acting on
that decision. Do not act on a constraint without checking whether it was retracted.

## Do not load as bulk context

`context/registers/` holds large working documents: the gap register, fix designs, the edge-case audit, and
the forward-workstream register. They run to hundreds of kilobytes and will crowd out the task. Open one
only when working the specific item it describes.

## How to work

- **Read before writing.** Never propose changes to code you have not read.
- **Determinism is not negotiable** for anything deciding group membership. See
  `docs/engineering/conventions.md`.
- **Respect package boundaries.** Engine packages (`parser`, `core`, `shared`) must not import from
  ecosystem packages (`cli`, `web`, `ui`, `api-client`, `types`).
- **Run the gates** in `docs/engineering/verification.md` before reporting work as done. Not every gate is
  runnable from every checkout; that file says which is which. A clean exit code is not evidence of
  success.
- **Label every timing cold or warm.** They differ by roughly eight times on this codebase, and unlabelled
  figures have produced wrong conclusions more than once.
- **Say what you did not verify.** An explicit gap is more useful than a confident guess.
- **Update state after meaningful work**, per the protocol in `context/README.md`.

## Commits

`type(scope): summary` in both repositories: lowercase, imperative, no trailing period, under about 70
characters. One commit per observable sub-behaviour, each independently building and passing. A commit that
does not build is not a rollback point.

| Where | Types |
|-------|-------|
| This repository, code under `packages/` | `feat` `fix` `test` `refactor` `perf` `chore` |
| This repository, documentation including this file | `docs` |
| `context/`, a decision file | `decision` |
| `context/`, STATE.md | `state` |
| `context/`, a register | `register` |

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
- **Real date before stamping anything** — Linux/macOS: `date '+%Y-%m-%d %H:%M'`; Windows: `Get-Date -Format 'yyyy-MM-dd HH:mm'`. A session can span days; its start date is not today's date.

Use **Node 20**. Only `packages/web` declares an `engines` constraint, so nothing enforces this, and the
engine test scripts behave differently on Node 21 and later in a way that can report a false pass. See
`docs/engineering/verification.md`.
