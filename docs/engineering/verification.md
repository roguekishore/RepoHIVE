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
| 2b. server tests | JDK 21+ (`./mvnw -B verify` in `repohive-server/`); no npm install | **Yes**, once a JDK 21+ is on `JAVA_HOME` |
| 3. determinism | install, build, and `fixtures/sample-java-project` | **Partly.** The comparison runs. The recorded digests to compare against are below, but the baseline history is in the mount |
| 4. real-repo smoke | recorded counts in `context/registers/measurements.md` | **No.** Needs the private mount |

`context/` is a private mount and is git-ignored. It is not missing by accident and it is not something
to reconstruct. If you do not have it, **Gate 4 is unavailable to you.** Say that in your report rather
than treating it as passed, skipped, or not applicable. A contributor who ran Gates 1 through 3 and cannot
run Gate 4 has done everything available to them; a contributor who claims all four passed without the
mount has misreported.

Every number in this document that is presented as measured was measured **in an earlier workspace, not in this repository**, and is attributed accordingly. None of it has been reproduced
against a public clone.

## Gate 1: build

```
npm run build
```

Runs `tsc -b packages/parser packages/core packages/engine packages/views packages/indexer`, then `node packages/views/scripts/write-views-version.mjs`. Must be clean. No new type errors, no suppressed
diagnostics.

The root build does **not** build the viewer or the server. For code in `packages/web`, also run `npm run type-check`
and `npm run build` in that workspace (the static export must succeed); for code in `repohive-server/`, Gate 2b.

Note that the root `npm run typecheck` is **byte-identical to `build`** and emits `dist/`. It is not a
no-emit check. The per-package no-emit checks are `typecheck` in `shared`, `parser`, and `core`, but
`type-check` in `web`. No root script runs it.

## Gate 2: tests

```
npm test
```

Runs `npm run test --workspaces --if-present`.

### Root `npm test`

Measured 2026-10-03 on `server-java` (Windows, Node v24.21.0, after `npm run build` and `next build` in `packages/web`): exit 0,
about 51 s warm. That was before the Next.js server half was removed, and **root `npm test` was not re-run
after it**; the per-workspace results on 2026-10-04 are below. **Root `npm test` does not run the Java server's tests**
(`repohive-server` is not an npm workspace); see Gate 2b. The `web` suite needs the root build (its tests import the
built `indexer`, `engine` and `views`), but it no longer needs `next build`, because the end-to-end test that started
the built server is gone; the end-to-end script is `npm run e2e --workspace @repohive/web` and runs on demand.

**A green `web` suite can hide skipped baseline tests.** `src/features/repository/snapshot-baseline.test.ts` compares
published views with baselines in `.agents/baselines/hosting-3` and with a store in `.repohive-local`. Both are
git-ignored, so on a clean clone the test logs `skipped: ...` with `console.warn` **and passes**. It checks something
only after you index the fixture through the server (`local/broadleafcommerce`) and have the baselines. Read the
output for `skipped:` before counting it.

### How the engine test script works, and the trap it replaced

Both `packages/core` and `packages/parser` declare:

```
"test": "node ../../scripts/run-node-tests.mjs"
```

The launcher (`scripts/run-node-tests.mjs` at the repo root, dependency-free, node: builtins only)
enumerates `dist/*.test.js` explicitly with `readdirSync`, sorts the list, and spawns
`node --test <files...>`. **If it finds zero test files it exits 1 with a clear message instead of
passing.** That guard is the point: a green run now means the suite actually ran. Because the file list
is passed explicitly, the run depends on neither shell glob expansion (bash versus `cmd.exe`) nor any
Node version's `--test` path semantics. Flags forward in `--flag=value` form, for example
`npm test -- --test-name-pattern=x`.

This requires a built `dist/`, so Gate 1 comes first; a missing or empty `dist/` fails loudly rather
than passing vacuously.

History, kept because the trap cost real time: the script used to be `node --test dist/*.test.js`,
which had **no correct form across Node versions**:

- The glob form relied on the shell. POSIX shells expand it, so it worked there on any Node. `cmd.exe`
  (npm's default script shell on Windows) does not, so the literal pattern reached Node: Node 21+
  expands it natively and works, Node 20 fails loudly with `Could not find …dist\*.test.js`.
- The alternative `node --test dist/` runs the suite on Node 20 but on **Node 21+ silently resolves to
  `dist/index.js` alone** and reports one passing test. A false green: exit 0, essentially none of the
  suite run. Do not reintroduce either form. A suspiciously fast engine run reporting a single test is
  this failure.

Measured 2026-09-13 on Node v26.4.0, Linux, in this repository, before the fix: `node --test dist/`
printed exactly one passing test named `dist` and exited 0 against 17 real test files (a file with no
test registrations counts as one passing test); the unexpanded glob, as `cmd.exe` would pass it, was
natively expanded and ran 153/153. Same day on Node v18.19.1: the unexpanded glob failed loudly
(`Could not find …dist/*.test.js`, exit 1) and the new launcher ran 153/153. **Node 20 and 21 through
25 were not measured**; their behaviour is reasoned from documented Node changes (test-runner glob
support landed in 21) and sits between the measured v18 and v26 endpoints. The old PowerShell
workaround (building the file list with `Get-ChildItem` and passing it to `node --test`) is obsolete;
the launcher does the same thing on every platform.

The root manifest now declares `"engines": { "node": ">=20" }` and `.nvmrc` pins `24`. Both are
advisory: npm only warns on an engines mismatch (no `engine-strict` is set), and `.nvmrc` binds only
tools that read it. `packages/web` additionally declares its own `engines` (`>=20.0.0`).

### Recorded per-workspace results

Measured **2026-08-22 in an earlier workspace** on Node v20.19.0 / npm 10.8.2, via
explicit file listing because the npm script of the time did not run (see the history above). The two
engine rows were **reproduced in this repository on 2026-09-13** (Node v26.4.0, Linux, fixed script):
core 153/153 and parser 181/181, where the parser delta against the table is known failure 1 below
passing on Linux. The non-engine rows were not reproduced here. Use these as the expected shape of a
run, and as the list a new failure has to be checked against.

| Workspace | Recorded result (2026-08-22, earlier workspace) |
|-----------|------------------------------------------------|
| `@repohive/core` | 153 / 153 pass |
| `@repohive/parser` | 180 / 181, one platform-dependent failure (Windows) |
| `@repohive/web` | 20 / 20 pass |

What *is* verifiable in this repository is the number of test **files**, which matches the earlier
workspace exactly: `core` 17, `parser` 11, `web` 5, `shared` 0.
That is consistency of test *surface*, not of results.

The `ui`, `types` and `api-client` packages are gone; their surviving code and tests are in `web`. Re-measured
2026-10-03 on `server-java`, Windows, Node v24.21.0, after that merge: `web` 283 / 283 in 41 files, `core` 176 / 176,
`parser` 235 pass and 1 skipped (236), `engine` 76 / 76, `indexer` 192 / 192. The numbers in the two paragraphs above
no longer apply to `web`.

After the Spring Boot cutover, 2026-10-04, Windows 11, Node v24.21.0, warm, one session: `indexer` 180 / 180 and `web` 231 tests
in 30 files, all passing; `tsc --noEmit` and the static `next build` clean. The drop from 192 to 180 in `indexer` is
the removed ledger, control Lambda and ledger-table tests. `parser`, `core` and `engine` were not re-run (no change to
them). On Linux, 2026-10-03, before the web cutover: `parser` 236 / 236, `core` 176 / 176, `engine` 76 / 76, `indexer`
192 / 192, `web` 295 / 295 in 42 files, from the baseline of that run.

## Gate 2b: the server tests

```
./mvnw -B verify
```

Run in `repohive-server/`. It compiles, runs the whole JUnit suite and builds the jar; the gate is **every test passing
and the jar built**. Read the Surefire summary (`Tests run: N, Failures: 0, Errors: 0`), not the exit code alone.
Measured 2026-10-04: **156 / 156** on Windows 11 with JDK 23.0.2, and on Linux x64 with OpenJDK 21.0.12 (Maven 3.9.16 from
the wrapper), both before the last portability commit; after it, 156 / 156 again on Windows only. After the runtime
limits control (admin API, `V3`), 176 / 176 on Windows 11, JDK 23.0.2, 2026-10-06; Linux was not re-run. Warm, with the
Maven repository already populated.

- **JDK.** The server needs Java 21 or newer. Set `JAVA_HOME` before running; the wrapper uses whatever `java` it finds.
  A machine whose default `java` is older fails with a compiler error about release 21, which is a missing
  precondition, not a regression. **Java 21 itself has not been run on Windows**, and **Linux has not run the current
  tests**: the Linux run predates the change below.
- **Tests must not depend on `sh`, on a Unix path, or on a binary on `PATH` other than `node`.** The tests that spawn a
  child (the pre-check runner, the local dispatcher) use `node -e` for fake children and absolute paths for scripts and
  directories, so they pass the same on Windows and Linux. A test that shells out to `sh -c` passes on Linux and
  fails on Windows; that is what the commit "run the process tests with node and absolute paths" fixed. Keep new tests
  free of it.
- Tests run against SQLite in a temporary directory, with a fake dispatcher and a fake pre-check runner
  (`src/test/java/com/repohive/support`); nothing reaches AWS or GitHub. **No AWS path is verified by a real call**:
  Step Functions, SSM and S3 are exercised against mocks only.

## Gate 2c: the end-to-end script

```
npm run e2e --workspace @repohive/web
```

Needs the jar (`./mvnw -B package` in `repohive-server/`), the root build, and a free port (default 3299,
`REPOHIVE_E2E_PORT`). It starts the jar on a scratch data directory and drives sign-up, an index request on a fixture
repository, the job's event stream, the limits and a forced system failure with its refund. Measured 2026-10-04,
Windows 11, Node 24.21.0, JDK 23.0.2: happy path, limits and refund pass, 37 s total, warm. It is not part of
`npm test`; there is no vitest wrapper for it any more.

### Known failures. Confirm these are the only ones

1. **`parser` → `src/source-collector.test.ts` → "a path that cannot become a node id is reported and
   the walk continues".** Asserts POSIX semantics where `\` is a legal filename character. It is
   **skipped on Windows** with a stated reason (it used to fail there) and still runs elsewhere, so a
   Windows parser run reports one skipped test, not a failure.

A change is clean if it does not add to this list. A new failure outside it is yours.

## Gate 3: determinism

```
npm run demo:group-determinism
```

Output digests must be byte-identical across repeated runs and across shuffled-input runs.

Recorded digests for `fixtures/sample-java-project`, whose sources are tracked in this repository
(its generated `graph.json` and `index/` are git-ignored):

| Artifact | SHA-256 | Last confirmed |
|----------|---------|------------------------------------|
| `group` | `dd475c2ac4482905386c6eaeb494145d48c0b0dff552e338c310a1f29fa65b2f` | 3 runs identical (4 regions, 38 nodes, depth 4), compact index format version 1 |
| `parse` | `a603b667abf1d7c903280a5ea661cae7087ecc90b9bafcfa9fbae25e7a6cccbc` | recorded 2026-08-16 |

The `group` digest hashes the index files' bytes (file name, then content, in contract order). It was
re-baselined when the index moved from pretty-printed JSON to the compact versioned format; the
previous value, `f30c7b3dfe38c476…`, belongs to the old format and no longer reproduces. The format change moved
those bytes and nothing else: the *logical digest*, SHA-256 of the canonical serialization of the `Hierarchy`
that `parseIndex` returns, is identical before and after for `sample-java-project` and for Broadleaf (values in
`context/registers/measurements.md`). The `parse` digest did not move. Both values are reproduced by
`npm run demo:group-determinism` and the engine integration suite.

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

- `node --test dist/` on Node 21+ reports one passing test and skips the suite. The engine scripts no
  longer use that form and their launcher refuses to pass on zero test files, but the trap still
  exists for anyone invoking `node --test` by hand.
- Gate 4 silently has nothing to check against when the mount is absent.

A clean exit code is not evidence. Read the actual output.
