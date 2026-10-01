# Verification Gates

A change is not done until these pass. Run them; do not assume them.

## Read this first: not every gate is runnable here

A fresh clone of this repository has **no `node_modules`, no `dist/`, and no `context/` mount.** Two of
the four gates depend on things that are not in the public repository. Know which is which before you
report anything as passing.

| Gate | What it needs | Runnable from a public clone? |
|------|---------------|-------------------------------|
| 1. build | `npm install` | **Yes**, after install |
| 2. tests | `npm install`, plus a built `dist/` for the engine | **Yes**, after install and build, with the caveats below |
| 3. determinism | install, build, and `fixtures/sample-java-project` | **Partly.** The comparison runs. The recorded digests to compare against are below, but the baseline history is in the mount |
| 4. real-repo smoke | recorded counts in `context/registers/measurements.md` | **No.** Needs the private mount |

`context/` is a private mount and is git-ignored. It is not missing by accident and it is not something
to reconstruct. If you do not have it, **Gate 4 is unavailable to you.** Say that in your report rather
than treating it as passed, skipped, or not applicable. A contributor who ran Gates 1 through 3 and cannot
run Gate 4 has done everything available to them; a contributor who claims all four passed without the
mount has misreported.

Every number in this document that is presented as measured was measured **in the private development
workspace, not in this repository**, and is attributed accordingly. None of it has been reproduced
against a public clone.

## Gate 1: build

```
npm run build
```

Runs `tsc -b packages/parser packages/core`. Must be clean. No new type errors, no suppressed
diagnostics.

Note that the root `npm run typecheck` is **byte-identical to `build`** and emits `dist/`. It is not a
no-emit check. The per-package no-emit checks are `typecheck` in `shared`, `parser`, and `core`, but
`type-check` in `api-client`, `types`, `ui`, and `web`. No root script runs the second group.

## Gate 2: tests

```
npm test
```

Runs `npm run test --workspaces --if-present`.

### Root `npm test` does not give you a usable pass/fail signal

It is expected to exit non-zero, because of known pre-existing failures listed below. One of those,
the missing `node_ids.json` fixture, is confirmed present in this repository as a defect: the import
target does not exist anywhere in the tree, so that workspace cannot pass. The overall non-zero exit is
therefore a sound inference. The exact exit code was **not measured against this repository.**

Treat `npm test` as a change detector, not a gate: compare its failures against the known list.

### The engine test script has no correct form. Read this before trusting a green run

Both `packages/core` and `packages/parser` declare:

```
"test": "node --test dist/*.test.js"
```

That text is confirmed verbatim in both manifests. Neither available form of the command is correct on
both Node versions:

- `node --test dist/*.test.js` needs the **shell** to expand the glob, which requires **Node 21+**.
  `cmd.exe` does not expand it either, so on Node 20 it fails with `Could not find …dist\*.test.js`.
  A loud failure, which is the safe kind.
- `node --test dist/` runs on Node 20, but on **Node 21+ it silently resolves to `dist/index.js` alone**
  and reports one passing test.

**That second form is a false green.** It exits 0, prints a passing test, and runs essentially none of
the suite. Do not "fix" the script by switching to it. If you see a suspiciously fast engine test run
reporting a single test, this is what happened.

Both failure modes are **reasoned from documented Node behaviour and from the script text. They were not
executed as part of writing this document.** Verify them in your own environment before depending on
either.

Nothing in the repository enforces a Node version. Only `packages/web` declares `engines`
(`>=20.0.0`); the root manifest declares none. So the version skew that breaks this script is
unconstrained, on a script that needs Node 21+ to work as written.

Until the script is fixed, verify the engine by listing files explicitly. Run from `packages/core` and
from `packages/parser`:

```powershell
$files = Get-ChildItem dist -Filter *.test.js | ForEach-Object { "dist/$($_.Name)" }
node --test @files
```

This requires a built `dist/`, so Gate 1 comes first.

### Recorded per-workspace results

Measured **2026-08-22 in the private development workspace** on Node v20.19.0 / npm 10.8.2.
**Not reproduced in this repository**, which has no installed dependencies. Use these as the expected
shape of a run, and as the list a new failure has to be checked against. Do not cite them as this
repository's current numbers.

| Workspace | Recorded result (2026-08-22, private workspace) |
|-----------|------------------------------------------------|
| `@repohive/core` | 153 / 153 pass, but the npm script does not run (see above) |
| `@repohive/parser` | 180 / 181, one platform-dependent failure, script does not run |
| `@repohive/api-client` | 50 / 50 pass |
| `@repohive/web` | 20 / 20 pass |
| `@repohive/types` | 2 suites fail, pre-existing, vendored |
| `@repohive/ui` | 1041 / 1042, one flaky failure, identity varies per run |

What *is* verifiable in this repository is the number of test **files**, which matches the private
workspace exactly: `core` 17, `parser` 11, `api-client` 5, `types` 3, `ui` 143, `web` 5, `shared` 0.
That is consistency of test *surface*, not of results.

### Known failures. Confirm these are the only ones

1. **`parser` → `src/source-collector.test.ts` → "a path that cannot become a node id is reported and
   the walk continues".** Asserts POSIX semantics where `\` is a legal filename character. Fails on
   Windows. Platform-dependent, not a regression. File confirmed present.
2. **`types` → `__tests__/node-ids.test.ts`** imports `../../../tests/fixtures/node_ids.json` at line
   15. **Confirmed: that file does not exist anywhere in this repository.** Vendored test
   infrastructure whose fixture was never vendored with it. This one is a real, locatable defect rather
   than an environmental quirk.
3. **`ui` render-budget tests**, `__tests__/token-drift.test.ts` and
   `__tests__/workspace/dsm-matrix.test.tsx`, fail intermittently and not always the same one.
   Timing-sensitive; vendored. Both files confirmed present.

A change is clean if it does not add to this list. A new failure outside it is yours.

## Gate 3: determinism

```
npm run demo:group-determinism
```

Output digests must be byte-identical across repeated runs and across shuffled-input runs.

Recorded digests for `fixtures/sample-java-project`, whose sources are tracked in this repository
(its generated `graph.json` and `index/` are git-ignored):

| Artifact | SHA-256 | Last confirmed (private workspace) |
|----------|---------|------------------------------------|
| `group` | `f30c7b3dfe38c476ada89a1175036cd36e1e623a08efc79345fd79beb3b4b5b3` | 2026-08-22, 3 runs identical (4 regions, 38 nodes, depth 4) |
| `parse` | `a603b667abf1d7c903280a5ea661cae7087ecc90b9bafcfa9fbae25e7a6cccbc` | recorded 2026-08-16 |

Neither digest was recomputed while writing this document.

The *repeatability* half of this gate is self-contained: run the command twice and compare its own
output. That works from a public clone. Comparing against the table above additionally assumes your
`fixtures/sample-java-project` matches the tracked sources that produced these values; a local edit to
them would move the digests.

If a digest moves, it is either a determinism regression or a legitimate output change. **Do not
recapture it silently.** Identify which field changed and why, record the reason in
`context/decisions/`, then update the table above in the same change. Without the mount you can still
do the first two steps; note that the decision record is owed.

## Gate 4: real-repo smoke (requires the private mount)

For changes to the parser, the grouping algorithm, or the contract, re-run against a real fixture and
compare against the recorded numbers in `context/registers/measurements.md`. A large unexplained swing in
node, edge, or region counts is a regression signal even when tests pass.

**Without the `context/` mount there is no baseline to compare against, and this gate cannot be run.** You
can still re-run the pipeline and record your own numbers for the next person; that is useful, but it is
not this gate. Report it as unavailable.

## Property tests are not a separate gate

The grouping algorithm's correctness properties are exercised by property tests using `fast-check`, present
in `core` and `parser` devDependencies and used across at least ten `core` test files. **They run as part of
Gate 2**, so there is nothing extra to invoke. The numbered specification those properties were written
against is not in this repository, so if you change algorithm behaviour, say which behaviour changed rather
than citing a property number.

## Cleanup

Delete any temporary files, scratch fixtures, or debug output created while verifying.

## Reporting

State which gates were run and their results. For any gate you could not run, say which one and why:
missing mount, missing install, missing build. Do not report overall success on the strength of the gates
that happened to be available, and do not report an unavailable gate as passing or as not applicable.

Two specific traps worth restating, because both produce a clean exit while proving nothing:

- `node --test dist/` on Node 21+ reports one passing test and skips the suite.
- Gate 4 silently has nothing to check against when the mount is absent.

A clean exit code is not evidence. Read the actual output.
