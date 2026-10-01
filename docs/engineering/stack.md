# Stack & Commands

Pinned facts. If something here disagrees with a `package.json`, the `package.json` wins. Fix this file.

## Runtime and language

- **TypeScript 5.9.3** pinned in the root `devDependencies`. Workspaces range independently
  (`^5.6.0` in `api-client`, `types`, `ui`; `^5.7` in `web`), so the root pin does not govern them.
- **Node.js**, developed on Node 24 (`runtime-moves-to-node-24`). The root manifest declares `"engines": { "node": ">=20" }`
  and `.nvmrc` pins `24`. Both are advisory rather than enforcement: npm only warns on an engines
  mismatch (no `engine-strict` is set), and `.nvmrc` binds only tools that read it. `packages/web`
  additionally declares its own `engines` (`>=20.0.0`). The engine test script no longer depends on
  the Node version or the shell; see below.
- ESM. `"type": "module"` is set in `shared`, `parser`, `core`, `types`, `api-client`, and `ui`. It is
  **not** set in the root manifest, and **not** in `packages/web` (Next.js handles module format there).
- **npm workspaces** monorepo, workspace glob `packages/*`.
- Licence: **AGPL-3.0-or-later**, declared at the root and in the engine packages. The vendored upstream
  UI packages are AGPL. Upstream attribution in `NOTICE`. Any new dependency must be licence-compatible.

## Engine dependencies

| Package | Version | Role |
|---------|---------|------|
| `web-tree-sitter` | `0.26.10` | Tree-Sitter runtime, **the WASM build, not the native binding** |
| `tree-sitter-java` | `0.23.5` | compiled Java grammar (ships a prebuilt `.wasm`) |
| `graphology` | `0.26.0` | in-memory directed weighted graph |
| `graphology-communities-louvain` | `2.0.2` | community detection behind the `CommunityDetector` interface |
| `graphology-metrics` | `2.4.0` | cohesion / coupling metrics |
| `fast-check` | `4.8.0` | property-based tests (dev) |

All six versions are exact, not ranged, in `packages/parser/package.json` and
`packages/core/package.json`.

Leiden can replace Louvain by adding an implementation behind `CommunityDetector`; callers do not
change. The interface is at `packages/core/src/community.ts`, alongside the seeded mulberry32 PRNG that
makes stochastic detectors reproducible.

**Do not install the native `tree-sitter` package.** It is absent from every manifest today. The parser
uses `web-tree-sitter` deliberately, to avoid native-compilation friction across platforms and CI. Both
WASM artifacts are resolved from `node_modules` at runtime by `resolveGrammarPaths`
(`packages/parser/src/ast-extractor.ts:129`), which means **any bundled deployment must pass
`GrammarOptions`** (`coreWasmPath` / `javaWasmPath`, declared at `ast-extractor.ts:97`). Bundlers drop
`.wasm` files and rewrite the module resolution this relies on.

## Viewer dependencies

In `packages/web`: `next ~15.5.21`, `react ^19.0.0`, `react-dom ^19.0.0`, Tailwind 4
(`@tailwindcss/postcss ^4.0.0`), `swr ^2.2.5`, `nuqs ^2.2.0`, `framer-motion ^11.11.0`, `recharts`,
`shiki`, `cmdk ^1.0.0`, `lucide-react`, `sonner ^2.0.7`, `next-themes ^0.4.6`, `geist ^1.3.0`.
Tests: **Vitest** (`^4.1.5` across every workspace that tests with it).

`packages/ui` carries its own, larger dependency set (Radix primitives, `elkjs`, `sigma`, `mermaid`,
`d3-*`, `zustand`, and others). Several packages appear in both trees at **different majors**:
`recharts` `^2.13.0` in `web` versus `^3.8.1` in `ui`; `shiki` `^1.22.0` versus `^4.0.0`;
`lucide-react` `^0.460.0` versus `^1.7.0`; `tailwind-merge` `^2.5.4` versus `^3.5.0`. `@types/node` is
`20.19.9` at the root, `^22` in `web`, `^26.1.0` in `api-client`. Nothing reconciles these. Assume a
component moved between packages may not behave identically.

The root also carries `shadcn ^4.12.0` in `devDependencies` with a root `components.json`.

## Tool choices with history

**Next.js stays for `packages/web`.** An earlier version of this file justified that by saying the
vendored packages depend on Next.js. That reason does not hold: `packages/ui`, `packages/types`, and
`packages/api-client` contain **zero** `next/*` imports, and `ui` peer-depends on `next-themes`, not on
`next`. The decision itself may still be right, but treat it as a choice to revisit deliberately rather
than as a constraint imposed by the vendored code.

**MySQL is not used.** Removed as the wrong fit for graph data, and absent from every manifest today.

**React Flow is a live dependency, narrowly scoped.** `@xyflow/react ^12.10.2` is a real dependency of
`packages/ui`, imported by 28 files under `packages/ui/src/c4/`. It is **not** used by the graph canvas
(`packages/ui/src/graph` has zero `@xyflow/react` imports) and **not** used by `packages/web` (zero
imports there; the C4 surface is reached through the `@repohive/ui/c4` entry point). The original intent
of listing React Flow as "do not reintroduce" was to protect the viewer's own canvas, which lays out
deterministically. That protection still stands for the graph canvas. Repo-wide, React Flow is present
and in use.

**Vite is approved for the CLI's single-file viewer artifact** (owner ruling, 2026-08-23), using
`vite-plugin-singlefile` to inline all JS and CSS into one `.html`. This is an *addition* alongside
Next.js, not a replacement: `packages/web` stays on Next.js. Recorded as a decision, **not yet as repo
state**: neither `vite` nor `vite-plugin-singlefile` appears in any manifest. (`@vitejs/plugin-react
^4.3.0` sits in `ui` devDependencies for Vitest, which is a different thing.) The plugin version and its
Vite compatibility range were not verifiable from this repository. An earlier blanket "do not
reintroduce Vite" line here was aimed at protecting the viewer app and wrongly forbade this.

## How to read this file

Owner ruling, 2026-08-23: **the lists here are not hard boundaries. New tools and dependencies may be
added when the work genuinely demands it.** What a "not used" entry means is "do not swap out a working
choice for this without a decision," not "never introduce anything new." Record any addition in
`context/decisions/` and update this file in the same change. Licence compatibility with
AGPL-3.0-or-later remains a hard rule.

## Commands

Run from the repo root.

| Command | Effect |
|---------|--------|
| `npm run build` | `tsc -b packages/parser packages/core packages/engine packages/views packages/indexer` |
| `npm run typecheck` | **identical to `build`**, see below |
| `npm test` | `npm run test --workspaces --if-present` |
| `npm run parse -- <dir>` | parse a Java tree → `graph.json` |
| `npm run group -- <args>` | group `graph.json` → `index/` |
| `npm run demo:group-determinism` | repeated-run SHA-256 comparison |
| `npm run demo:baselines` | baseline comparison output |
| `npm run dev --workspace @repohive/web` | viewer on port 3000 (long-running; the user starts this, not the agent) |

**The root `typecheck` script is not a no-emit check.** It is
`tsc -b packages/parser packages/core packages/engine packages/views packages/indexer`, byte-identical to `build`, so it writes `dist/`. Real no-emit checks live per package, under two
different names: `typecheck` (`tsc --noEmit`) in `shared`, `parser`, and `core`, but `type-check` in
`api-client`, `types`, `ui`, and `web`. There is no root script that runs the second group.

### The engine test script runs an explicit launcher

The test script in both `packages/core` and `packages/parser` is
`node ../../scripts/run-node-tests.mjs`. The launcher (repo root, dependency-free) enumerates
`dist/*.test.js` via `readdirSync`, sorts the list, and spawns `node --test <files...>`; it **exits 1
with a clear message when zero test files are found**, so a vacuous green run is impossible and an
unbuilt `dist/` fails loudly. Because the file list is passed explicitly, it behaves the same on
Node 20 and 21+, under POSIX shells and Windows (`cmd.exe`/PowerShell) alike.

History: the script used to be `node --test dist/*.test.js`, which worked only where the shell
expanded the glob (POSIX shells on any Node; `cmd.exe` only on Node 21+, loud failure on Node 20),
while the alternative `node --test dist/` on Node 21+ silently resolved to `dist/index.js` and
reported **one passing test, a green run proving nothing**. That false green was reproduced on Node
v26.4.0 on 2026-09-13 before the fix. The old PowerShell workaround (building the file list with
`Get-ChildItem` and passing it to `node --test`) is obsolete; the launcher does the same thing on
every platform. Do not switch the script back to either historical form.

`docs/engineering/verification.md` carries the expected counts, the known-failure list, and the
measured-versus-reasoned status per Node version.

`npm run parse` resolves relative paths against `INIT_CWD` (`packages/parser/src/parse-cli.ts:59`),
because npm's `--workspace` indirection changes the working directory. It is a convenience wrapper
around the parser's CLI entry point, not the packaged CLI, which does not exist:
`packages/cli` contains only a `.gitkeep`.

## Storage

JSON files on disk. No database. `graph.json` is **estimated** at roughly 10 to 20 MB for a 4k-file
repository (ids and small integers only, no source text). That figure is an estimate, not a measurement.

**The storage seam is asymmetric, not complete.** The *write* path has one: `IndexSerializerDeps`
(`packages/core/src/index-serializer.ts`) injects `mkdirSync` / `writeChunksSync` / `renameSync` /
`rmSync` / `existsSync` / `assertWritable` with an fs default, added so write failures were testable, and
the parser's `SerializerDeps` does the same with `writeChunks`. Both write **chunks**, never a whole-artifact
string (V8 caps a string at about 512 million characters). The *read* path of the index has none:
`packages/core/src/index-parser.ts:10` and `packages/core/src/orchestrator.ts:7` import from `node:fs`
directly. So swapping in a graph-native or object store means **mirroring an existing in-repo pattern onto
the read path**, not inventing an abstraction.

The parser reaches the filesystem through the same inject-with-fs-default pattern in `input-validator.ts`,
`source-collector.ts`, `serializer.ts` and, for source bytes, `ParseDeps.readBytes` / `fileSize`. A source
need not be a directory: `ParseOptions.source` (and `EngineOptions.source`) take `{ path, bytes }` entries
instead, selected by the same policy as a directory walk (`source-selection.ts`), and `ParseOptions.writeGraph`
/ `EngineOptions.writeGraph` can skip `graph.json` and return the graph in memory.

Extraction and stitching run on a pool of worker threads (`extraction-pool.ts`, `extraction-worker.ts`):
phase 1 extracts files from one queue, largest first, and the main thread merges the per-worker symbol-table
shares in canonical order; phase 2 gives every worker the merged table once, read-only, and each stitches
its own files. Every result is keyed by the file's index in the canonical list, so output does not depend on
`workers`, `concurrency` or completion order. `ParseDeps.pipeline` is the seam tests inject.

**Progress.** `EngineOptions.onProgress` receives stage `start` / `complete` events, a `progress` event per
selected file during parse (`completed` from 0, `total`), and one per grouping sub-stage during group
(`substage`: `ingest`, `weight`, `assess`, `construct`, `hierarchy`, `metadata`, `write`). The engine does not
await or throttle the callback. Parse is driven by worker messages and group yields to the event loop
(`setImmediate`) before each sub-stage, so work the callback schedules runs while the stage is going. Core's
`groupGraphToIndexAsync` also writes the five index files concurrently (`serializeIndexAsync`, same
staging-then-rename publish); the synchronous `groupGraphToIndex` and `serializeIndex` remain for the CLI-style
callers and tests. Progress and write concurrency cannot change an output byte.

**Snapshot-id inputs.** `engineVersion` (16 hex characters) is a hash of the compiled code of `shared`,
`parser`, `core` and `engine`, the installed `tree-sitter-java` and `web-tree-sitter` versions, and
`INDEX_FORMAT_VERSION`: fixed for a build, and it needs the packages built (`dist/`). `configDigest(options)` is
the SHA-256 of the resolved grouping config and the resolved exclusion list; options that cannot change output
are not in it.
