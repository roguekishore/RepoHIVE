# Conventions & Hard Rules

Rules that hold regardless of task. Breaking one is a defect, not a style choice.

## Determinism

Identical input must produce **byte-identical** output.

- No `Math.random`. No timestamps, wall-clock reads, or global counters in ids or output.
- No dependence on filesystem iteration order, `Object.keys` order, or `Set`/`Map` insertion order for
  anything that reaches an artifact.
- Community detection runs **seeded**, over **canonically-sorted** nodes and edges.
- Group ids are content-addressed.
- Ties break on a stable key (id), never on arrival order.

Anything that decides group membership must be deterministic and explainable from structure alone.
Non-deterministic inputs (model output, embeddings, heuristics with hidden state) may inform labels,
search, or summaries. Never membership.

The first rule currently holds in engine source: no `Math.random`, `Date.now()`, or `new Date(` appears
in `packages/{parser,core,shared}/src` outside test files. Seeding is real, via the mulberry32
`seededRng` in `packages/core/src/community.ts`. The content-addressed group id rule is the one claim
here that is only **partly** confirmed: the id format appears as `g_<hash>` in test commentary, but
`hierarchy-builder.ts` contains no hashing call, so the derivation was not traced. Re-verify before
relying on it.

## The JSON contract

Additive changes are safe. Renaming or removing a field, or changing its meaning, is a breaking change
that needs an explicit decision recorded in `context/decisions/`.

Consumers join groups to decisions via `regionId` / `ordinal` / `groupIds`. Never reconstruct that
relationship from paths or package prefixes.

## Design

Applies to `packages/design`.

- **Tokens only.** Every colour, font family, size, radius, spacing step and motion value is a custom property in
  `src/styles/tokens.css`. `src/gates/tokens-only.test.ts` fails on a literal anywhere else. Change the design system
  by editing that file, not a component.
- **Canvases are deterministic.** Layout is seeded and stable: no `Math.random`, no clock, and ties broken by a hash of
  the item's key, never input order. Identical input gives identical pixels. Colours come from the palette at run
  time (`useCanvasPalette`) and repaint on a theme change.
- **Show recorded values only.** Never display a number the engine did not record, and never compute a metric in the
  browser to fill a gap. A field the host cannot supply is optional in the contract and the screen hides it.
- **Kept versus rebuilt is never colour alone.** Kept is a solid outline, rebuilt a dashed outline in plum, and
  unassessed a third neutral state.
- **Dependency direction.** `packages/web` imports `@repohive/design`, never the reverse, and `design` imports nothing
  from Next.js.

## Package boundaries

Engine (`parser`, `core`, `shared`) must not import from ecosystem packages (`web`, `views`,
`indexer`). Check this before adding an import.

The rule holds today. Engine source imports nothing from the ecosystem, and `parser` and `core` do not
import each other.

## Code

- Match the surrounding file's existing style, naming, and error-handling patterns before introducing
  anything new.
- Prefer explicit over clever. These artifacts get audited.
- No em dashes in generated code comments or commit messages.

## Commits

`type(scope): summary`, lowercase, imperative, no trailing period, under ~70 characters.

In this repository:

- Code under `packages/`: `feat` · `fix` · `test` · `refactor` · `perf` · `chore`
- Documentation, including these engineering files: `docs:`

In the separate private context repository:

- A decision file: `decision:`
- `STATE.md`: `state:`
- The large registers: `register:`

**Granularity:** one commit per observable sub-behaviour, each independently building and passing. A
commit that does not build is not a rollback point.

Documentation and context changes belong on `main`. If the current branch is a feature branch and the
only changes are docs or context files, say so rather than committing them there.

## Git operations

Ordinary commits are fine when asked. **Milestone operations are owner-driven and must never be run
unprompted:** merges to `main`, tags, branch creation or deletion, pushes, rebases, force-push,
`reset --hard`, `--no-verify`. Stage explicit paths; never `git add .`.

## Honesty in records

- Record only work that actually happened. Never fabricate progress, results, dates, or test counts.
- Label estimates as estimates. Report measured numbers only when they were measured in this session or
  are cited from a recorded measurement, with the recording attributed.
- "The command exited 0" is not evidence a task succeeded. Verify the actual output. The old engine test
  script was a live example: one of its forms reported a single passing test and exited clean while
  running almost nothing; every package now runs tests through the shared launcher. See `docs/engineering/verification.md`.
- If something could not be verified, say so explicitly. Never promote an unverified claim to a fact by
  restating it without its qualifier.

## Timestamps

Before writing any date or time into a document or record, read the real clock:

```
Get-Date -Format 'yyyy-MM-dd HH:mm'
```

Use that value. Never reuse the date a session started, and never carry a date forward from an existing
document. Sessions span multiple days, and a copied date silently backdates real work.

## Shell

Windows. The shell does not accept `&&` as a separator; use `;`. Never `cd`; pass a working directory
instead. Never start long-running processes (dev servers, watchers) as blocking commands.
