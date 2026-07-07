# Review 1 — Parser Demonstration Guide

**Deliverable:** `parse` — Java repo → `graph.json` (the flat dependency graph).
**Review date:** 03.07.2026 · **Spec:** `.kiro/specs/dependency-graph-parser/`
**Branch:** `phase-1-parser` (13 commits, `origin/phase-1-parser` up to date)

> Message for this review: *"Here's the raw flat dependency graph. Flat doesn't scale — here's the
> evidence."* Everything below was actually run against this repo on 2026-07-07 to verify it still
> works, not just written from memory.

---

## 1. What was built

- `packages/shared` — the JSON contract (`GraphNode`, `DependencyEdge`, `RawDependencyGraph`), the
  stable seam the grouping algorithm will read in Review 2.
- `packages/parser` — the full pipeline: input validation → recursive `.java` collection →
  Tree-Sitter AST extraction (file/class/function nodes) → symbol-table construction → cross-file
  stitching into de-duplicated import edges with frequency signals → canonical, deterministic
  serialization → atomic write of `graph.json`.
- A determinism harness (`verifyDeterminism`) and demo CLIs (`parse`, `demo:determinism`).
- A hand-written fixture (`fixtures/sample-java-project/`) checked into git for stable, reproducible
  demos.
- 102 tests (property-based + unit), all passing.

All 16 tasks in `.kiro/specs/dependency-graph-parser/tasks.md` are checked off.

## 2. Prerequisites

- Node.js installed, dependencies installed once via `npm install` at the repo root
  (`D:\PROJECTS\GRAPH`).
- No build step needed to *run* the demo below — `npm run build` compiles TypeScript to
  `packages/parser/dist`, which the demo scripts execute.

```
npm install       # once, if not already done
npm run build      # compiles packages/parser (tsc -b packages/parser)
```

Verified 2026-07-07: `npm run build` completes with exit code 0, no errors.

## 3. Demo A — parse the fixture project and inspect `graph.json`

This is the primary "show the JSON" demo for the review.

```
npm run parse -- fixtures/sample-java-project
```

**Actual output (captured 2026-07-07):**

```
RepoHIVE parser — parse
  project : D:\PROJECTS\GRAPH\fixtures\sample-java-project
  nodes   : 29
  edges   : 5
  output  : D:\PROJECTS\GRAPH\fixtures\sample-java-project\graph.json
  result  : OK
```

Then open `fixtures/sample-java-project/graph.json` and show the reviewer the shape — e.g. the first
node:

```json
{
  "id": "class:com.example.Bootstrap",
  "kind": "class",
  "packagePath": "com.example",
  "directoryPath": "",
  "definedInFile": "file:Bootstrap.java"
}
```

Talking points while showing it:
- Every node/edge conforms exactly to the shared contract (`packages/shared/src/contract.ts`) —
  this is the seam Review 2's grouping algorithm will consume with zero rework.
- `fixtures/sample-java-project/` is a small, hand-written multi-package project (5 `.java` files)
  chosen specifically to exercise nested/inner types, method overloads, and cross-file imports — see
  `fixtures/sample-java-project/README.md`.
- `graph.json` itself is git-ignored (regenerated output), but the fixture's *source* is checked in
  so the demo is reproducible on any machine.

## 4. Demo B — determinism proof

This demonstrates the "no `Math.random`, no timestamps" hard requirement from the tech-stack rules.

```
npm run demo:determinism --workspace @repohive/parser
```

(equivalently, `cd packages/parser && npm run demo:determinism`)

**Actual output (captured 2026-07-07):**

```
RepoHIVE parser — determinism check
  project : D:\PROJECTS\GRAPH\fixtures\sample-java-project
  runs    : 3
  nodes   : 29
  edges   : 5
  sha-256 : 51bfd2f389db9f932d727ce457ff34406d81cb3023d00c86f64887499fdf1823
  result  : DETERMINISTIC (identical digest across all runs)
```

Talking point: the same SHA-256 (`51bfd2f3…`) across independent runs is the reproducibility evidence
that a reviewer can ask to see regenerated live.

## 5. Demo C (optional, "scale" evidence) — parse a real Spring Boot repo

If the panel wants something bigger than the 5-file fixture, `fixtures/vantage/` is a real
(git-ignored, third-party) Spring Boot project checked out locally with 158 `.java` files.

```
npm run parse -- fixtures/vantage
```

**Actual output (captured 2026-07-07):**

```
RepoHIVE parser — parse
  project : D:\PROJECTS\GRAPH\fixtures\vantage
  nodes   : 803
  edges   : 128
  output  : D:\PROJECTS\GRAPH\fixtures\vantage\graph.json
  result  : OK
```

This is useful to show the parser working on a real, unmodified open-source codebase — not just a
synthetic fixture — while staying honest that 803 nodes / 158 files is nowhere near the 4,000-file
target scale (that claim is for Review 3 / the paper, not this review).

## 6. Demo D — run the test suite

```
npm run test --workspace @repohive/parser
```

**Actual result (captured 2026-07-07):** `102 tests, 102 pass, 0 fail`, covering:
- Property-based tests: determinism/byte-identity, ID stability & uniqueness, contract conformance,
  edge de-duplication, frequency non-negativity, symbol-table collision determinism, canonical
  ordering, no-partial-output-on-error.
- Unit tests: input validation branches, source collection edge cases, AST extraction (nested types,
  overloads, default package), serializer boundaries, end-to-end fixture→contract conformance.

## 7. What to say if asked "what's next"

Review 2 (15.07.2026) consumes this exact `graph.json` shape and turns it into a navigable hierarchy
via adaptive preserve-vs-reconstruct grouping (`packages/core`, currently unbuilt). The safety valve
if the parser weren't ready would be running `group` on a synthetic `graph.json` — not needed here
since the parser is done and verified.

---

## 8. Gaps / things NOT yet done (flagged, not hidden)

Verification found the parser implementation itself complete and passing, but these review-1-adjacent
items are outstanding:

1. **Not merged to `main`, no `review-1` tag.** All 13 parser commits live on `phase-1-parser`
   (pushed to `origin/phase-1-parser`); `main` is still at the pre-parser commit. Per
   `steering/git-workflow.md`, a review-ready phase should be merged to `main` and tagged
   `review-1`. This is a deliberate manual step (git safety rules mean I don't merge/tag without
   your say-so) — want me to do that now?
2. **`steering/git-workflow.md` and `PROJECT_STATE.md` say "git not yet initialized" — that's stale.**
   Git has been initialized for a while (13+ commits, a remote, two branches). Worth a quick doc fix
   so future sessions aren't misled.
3. **Project diary team/date fields are still blank placeholders** (`Team No.: _____`,
   `Dates (start – end): _____`). Fine for internal work, but if this diary is turned in physically at
   Review 1, those need filling before submission.
4. **No vault task-record exists for the parser work.** The parser was built (2026-07-01) before the
   Basic Memory task-documentation system existed (2026-07-06), so there's no `tasks/` narrative or
   test-matrix for it — only the BRAIN/PROJECT_STATE entries. Not a blocker for the review itself, but
   means the standard "Close task" checklist (test-matrix required) was never run against this work.
5. **Nothing else missing from the spec** — all 10 requirements and all 16 tasks in
   `dependency-graph-parser` are implemented and test-covered; I did not find any unimplemented
   acceptance criterion while cross-checking `requirements.md`/`design.md` against the code.

None of these block demonstrating the parser Tuesday — they're process/paperwork items, not missing
functionality. Items 1–3 are quick fixes if you want them done before the review.
