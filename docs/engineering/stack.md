# Stack & Commands

Pinned facts. If something here disagrees with a `package.json`, the `package.json` wins. Fix this file.

## Runtime and language

- **TypeScript 5.9.3** pinned in the root `devDependencies`. Workspaces range independently
  (`^5.6.0` in `api-client`, `types`, `ui`; `^5.7` in `web`), so the root pin does not govern them.
- **Node.js**, developed on Node 20 and 21+. Nothing in the repository enforces a version: only
  `packages/web` declares `engines` (`>=20.0.0`), and the root manifest declares none. See the engine
  test script warning below, which needs Node 21+ to work as written.
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
| `npm run build` | `tsc -b packages/parser packages/core` |
| `npm run typecheck` | **identical to `build`**, see below |
| `npm test` | `npm run test --workspaces --if-present` |
| `npm run parse -- <dir>` | parse a Java tree → `graph.json` |
| `npm run group -- <args>` | group `graph.json` → `index/` |
| `npm run demo:group-determinism` | repeated-run SHA-256 comparison |
| `npm run demo:baselines` | baseline comparison output |
| `npm run dev --workspace @repohive/web` | viewer on port 3000 (long-running; the user starts this, not the agent) |

**The root `typecheck` script is not a no-emit check.** It is `tsc -b packages/parser packages/core`,
byte-identical to `build`, so it writes `dist/`. Real no-emit checks live per package, under two
different names: `typecheck` (`tsc --noEmit`) in `shared`, `parser`, and `core`, but `type-check` in
`api-client`, `types`, `ui`, and `web`. There is no root script that runs the second group.

### The engine test script has no correct form

**The engine test script in both `packages/core` and `packages/parser` is `node --test dist/*.test.js`,
and it does not work across both Node versions.** Neither form does:

- `node --test dist/*.test.js` relies on the shell expanding the glob, which needs **Node 21+**.
  `cmd.exe` does not expand it either, so on Node 20 it fails with `Could not find …dist\*.test.js`.
- `node --test dist/` runs on Node 20 but on Node 21+ silently resolves to `dist/index.js` and reports
  one passing test. **That is a green run proving nothing.**

The script text is confirmed verbatim in both manifests. The two failure modes are **reasoned from
documented Node behaviour, not measured here.** Verify them yourself before depending on either.

Until the script is fixed, verify the engine by listing the files explicitly. From `packages/core` and
`packages/parser`:

```powershell
$files = Get-ChildItem dist -Filter *.test.js | ForEach-Object { "dist/$($_.Name)" }
node --test @files
```

`docs/engineering/verification.md` carries the expected counts and the known-failure list. **No "green
suite" claim from `npm test` is trustworthy while this stands.**

`npm run parse` resolves relative paths against `INIT_CWD` (`packages/parser/src/parse-cli.ts:59`),
because npm's `--workspace` indirection changes the working directory. It is a convenience wrapper
around the parser's CLI entry point, not the packaged CLI, which does not exist:
`packages/cli` contains only a `.gitkeep`.

## Storage

JSON files on disk. No database. `graph.json` is **estimated** at roughly 10 to 20 MB for a 4k-file
repository (ids and small integers only, no source text). That figure is an estimate, not a measurement.

**The storage seam is asymmetric, not complete.** The *write* path has one: `IndexSerializerDeps`
(`packages/core/src/index-serializer.ts:107`) injects `mkdirSync` / `writeFileSync` / `renameSync` /
`rmSync` / `existsSync` / `assertWritable` with an fs default, added so write failures were testable.
The *read* path has none: `packages/core/src/index-parser.ts:10` and
`packages/core/src/orchestrator.ts:7` import from `node:fs` directly. So swapping in a graph-native or
object store means **mirroring an existing in-repo pattern onto the read path**, not inventing an
abstraction.

The parser reaches the filesystem through the same inject-with-fs-default pattern in four places:
`input-validator.ts`, `source-collector.ts`, `serializer.ts`, and `ast-extractor.ts` (its `readFile`
dependency). Whether each is actually wired through to `parseProject` callers, or only reachable from
tests, was **not verified**. `ParseOptions.projectDirectory` is a required `string`
(`packages/parser/src/orchestrator.ts:73`), so parsing from a non-directory source is a real seam
change regardless.
