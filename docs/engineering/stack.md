# Stack & Commands

Pinned facts. If something here disagrees with a `package.json`, the `package.json` wins. Fix this file.

## Runtime and language

- **TypeScript 5.9.3** pinned in the root `devDependencies`. `web` ranges
  independently (`^5.7`), so the root pin does not govern it.
- **Node.js**, developed on Node 24 (`runtime-moves-to-node-24`). The root manifest declares `"engines": { "node": ">=20" }`
  and `.nvmrc` pins `24`. Both are advisory rather than enforcement: npm only warns on an engines
  mismatch (no `engine-strict` is set), and `.nvmrc` binds only tools that read it. `packages/web`
  additionally declares its own `engines` (`>=20.0.0`). The engine test script no longer depends on
  the Node version or the shell; see below.
- **Java 21** for `repohive-server/` (`java.version` is 21 in its `pom.xml`). Nothing enforces the JDK either: any
  JDK 21 or newer builds it (built on 21.0.12 and on 23.0.2). **Check which `java` is first on
  `PATH`**: a machine can have several JDKs and an old default (the Windows dev machine's default was 14), and Maven
  then fails with a bare "release version 21 not supported". Set `JAVA_HOME` to a 21+ JDK.
- **Maven 3.9.16**, through the committed wrapper (`repohive-server/mvnw`, `mvnw.cmd`). The wrapper is
  `distributionType=only-script`: it downloads Maven on first use and commits no binary jar.
- ESM. `"type": "module"` is set in `shared`, `parser` and `core`. It is
  **not** set in the root manifest, and **not** in `packages/web` (Next.js handles module format there).
- **npm workspaces** monorepo, workspace glob `packages/*`.
- Licence: **AGPL-3.0-or-later**, declared at the root and in the engine packages. The upstream
  UI code that remains in `packages/web` is AGPL.
  Upstream attribution in `NOTICE`. Any new dependency must be licence-compatible.

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

## Indexer dependencies (`packages/indexer`)

| Package | Version | Role |
|---------|---------|------|
| `tar-stream` | `3.2.1` | MIT; streams the repository archive (`tarball.ts`); ships its own types, so `@types/tar-stream` is not used |
| `@aws-sdk/client-s3` | `3.1144.0` | S3 `ArtifactStore` (`artifact-store-s3.ts`) |
| `@aws-sdk/client-ssm` | `3.1144.0` | reads the GitHub token and the internal secret from SSM SecureString parameters |
| `@types/aws-lambda` | `8.10.164` | dev only; Lambda handler types |
| `aws-sdk-client-mock` | `4.1.0` | dev only; mocks the S3 client in `artifact-store.test.ts` |

Exact pins in `packages/indexer/package.json`. `@aws-sdk/client-dynamodb` was removed with the ledger; the job reports to the server over `fetch`, with no HTTP
client dependency.

## Server dependencies (`repohive-server`)

Exact versions in `repohive-server/pom.xml`; the first two are Maven properties or the parent version.

| Dependency | Version | Role |
|------------|---------|------|
| Spring Boot (`spring-boot-starter-parent`, `-web`, `-jdbc`, `-test`) | 3.5.16 | HTTP, `JdbcTemplate`, tests (JUnit 5). No JPA, no Spring Security, no Actuator |
| `org.flywaydb:flyway-core` | 11.7.2 | migrations `V1`, `V2` (`src/main/resources/db/migration`) |
| `org.xerial:sqlite-jdbc` | 3.53.4.0 | SQLite driver; the SQL is kept portable, PostgreSQL is not built |
| `org.bouncycastle:bcprov-jdk18on` | 1.86 | scrypt, for password hashes verifiable against the old Node ones |
| `org.brotli:dec` | 0.1.2 | brotli decoding in `ArtifactService` and `ArtifactController`, the local `/artifacts/**` route |
| AWS SDK for Java v2 (`bom` 2.55.11): `s3`, `sfn`, `ssm` | 2.55.11 | object store, Step Functions dispatch and reconciliation, SSM secrets |

Spring Boot is pinned to its latest 3.x release at the time the server was written, exactly (no range). A change
to any version here is a dependency change: record it in `context/decisions/`.

## Viewer dependencies

In `packages/web`: `next ~15.5.21`, `react ^19.0.0`, `react-dom ^19.0.0`, Tailwind 4
(`@tailwindcss/postcss ^4.0.0`), `swr ^2.2.5`, `nuqs ^2.2.0`, `lucide-react ^1.7.0`, `next-themes ^0.4.6`, `geist ^1.3.0`,
the Radix primitives the UI uses (`react-dialog`, `react-slot`, `react-tooltip`), `class-variance-authority`,
`tailwind-merge ^3.5.0`, `@tanstack/react-virtual`, and for the flat baseline `sigma ^3.0.3`, `graphology ^0.26.0`
and `graphology-layout-forceatlas2`.
The web package has **no AWS SDK, no database driver and no server dependency**. `@repohive/indexer` and
`@repohive/engine` are devDependencies, for tests and the end-to-end script only.
Tests: **Vitest** (`^4.1.5`, in two projects: `views` on Node for `src/views`, `client` on jsdom for components,
features, lib and styles) with Testing Library. `@types/node` is `20.19.9` at the root and `^22` in `web`.

The root also carries `shadcn ^4.12.0` in `devDependencies` with a root `components.json`.

## Tool choices with history

**Next.js stays for `packages/web`, as a static export.** Most of `components/` and `features/` import nothing from
`next/*`, so the choice is not forced by the UI code; treat it as one to revisit deliberately. Export worked with
placeholder shells and a host mapping, so the fallbacks considered (a catch-all shell, then Vite) were
not needed.

**Spring Boot on JDBC, not JPA, with no Spring Security.** JPA would hide SQL that has to stay portable, and Spring
Security's defaults (CSRF tokens, its own session handling) would change the cookie and origin-check behaviour the
viewer relies on. Do not add either without a decision.

**MySQL is not used.** Removed as the wrong fit for graph data, and absent from every manifest today.

**React Flow is not used.** `@xyflow/react` was removed together with the `c4` and
`workspace` surfaces that were its only importers. The viewer's own canvas lays out deterministically and
stays off React Flow.

**Vite is approved for the CLI's single-file viewer artifact** (decision, 2026-08-23), using
`vite-plugin-singlefile` to inline all JS and CSS into one `.html`. This is an *addition* alongside
Next.js, not a replacement: `packages/web` stays on Next.js. Recorded as a decision, **not yet as repo
state**: neither `vite` nor `vite-plugin-singlefile` appears in any manifest. (`@vitejs/plugin-react
^4.3.0` sits in `web` devDependencies for Vitest, which is a different thing.) The plugin version and its
Vite compatibility range were not verifiable from this repository. An earlier blanket "do not
reintroduce Vite" line here was aimed at protecting the viewer app and wrongly forbade this.

## How to read this file

Decision, 2026-08-23: **the lists here are not hard boundaries. New tools and dependencies may be
added when the work genuinely demands it.** What a "not used" entry means is "do not swap out a working
choice for this without a decision," not "never introduce anything new." Record any addition in
`context/decisions/` and update this file in the same change. Licence compatibility with
AGPL-3.0-or-later remains a hard rule.

## Deploy tree (`deploy/`)

Run against an AWS account with that account's credentials in the profile `repohive` (see the scripts below). The tree
describes the current stack (see `architecture.md`, "Deploy tree"); none of it has been applied to AWS yet. Exact pins:

| Tool | Pin | Licence note |
|------|-----|--------------|
| Terraform | `>= 1.11.0, < 2.0.0` (S3 native locking needs 1.11); developed on 1.16.2 | BUSL-1.1. A build tool the owner runs; nothing of it is linked or shipped |
| `hashicorp/aws` provider | 6.67.0 | MPL-2.0 |
| `hashicorp/random` provider | 3.9.1 | MPL-2.0 |
| `@aws-sdk/client-ssm` (`packages/indexer`) | 3.1144.0, the version of the other `@aws-sdk` clients there | Apache-2.0 |
| Caddy | 2.11.6, built by xcaddy | Apache-2.0 |
| `xcaddy` | v0.4.7 | Apache-2.0 |
| `github.com/mholt/caddy-ratelimit` | v0.1.0 | Apache-2.0 |
| `github.com/xcaddyplugins/caddy-trusted-cloudfront` | v0.0.0-20240604042247-0a0864e80f1c (commit 0a0864e, no tagged release) | MIT |
| Node on the box and in the release build | 24.21.0, the binary of `node:24.21.0-bookworm-slim` (the box needs it only for the server's pre-check child) | MIT |
| Java on the box and in the release build | Temurin 21: the JRE copied from `eclipse-temurin:21-jre-jammy`, the jar built with `eclipse-temurin:21-jdk-jammy` | GPL-2.0 with Classpath Exception |
| Release build images (`deploy/box/Dockerfile.release`) | `node:24.21.0-bookworm-slim@sha256:0e0ff40c…`, `golang:1.26-bookworm@sha256:a688600c…` (index digests read from Docker Hub), `eclipse-temurin:21-jdk-jammy@sha256:e0c60c48…` and `21-jre-jammy@sha256:f04fb34e…` (read 2026-10-06) | Node MIT; Go BSD-3-Clause; Temurin as above |
| Box OS | Amazon Linux 2023 arm64, newest AMI from the public SSM parameter at first apply (`ami` is not tracked afterwards) | |

The indexer image's base images (`public.ecr.aws/...`) are **not** pinned by digest yet.

Each root commits `.terraform.lock.hcl`, locked for `windows_amd64` only (Terraform is run from Windows). Running Terraform from another platform, such as WSL, needs `terraform providers lock
-platform=<os_arch>` first, or `init` fails on a checksum. No other provider and no registry module. The table above is every pinned tool of the deploy
tree. `deploy/RUNBOOK.md` is the owner's step-by-step.

Deploy scripts (bash, `deploy/scripts/`; Git Bash, WSL or Linux). Run them against an account once its credentials are
in the AWS CLI profile `repohive`; every apply still waits for the owner's go on a printed plan. Each script works on one
account folder, `deploy/accounts/<name>/` (git-ignored), named by `REPOHIVE_ACCOUNT=<name>`; every script that calls AWS
loads its `deploy.env` and stops unless `aws sts get-caller-identity` matches its account id (`lib.sh`):

| Script | Effect |
|--------|--------|
| `put-github-token.sh` | stores `/repohive/github-token` (token from a hidden prompt or a piped file) |
| `put-admin-token.sh [--generate]` | stores `/repohive/admin-token`, which switches on the server's `/api/admin/**` (limits page); `--generate` shows a new token once and only on a terminal |
| `build-in-github.sh [--verify-only]` | pushes the tag `build-<account>-<sha>` (or `verify-<sha>`) and follows the `build.yml` run; creates the account's GitHub environment first |
| `github-environment.sh` | creates or updates the GitHub environment `<account>`: tags `build-<account>-*` only, variables `AWS_ACCOUNT_ID`, `SITE_DOMAIN` |
| `build-indexer-image.sh` | `docker buildx build --platform linux/arm64 --provenance=false`, tagged with the 12-character git SHA; refuses uncommitted changes under `packages/` |
| `push-indexer-image.sh [tag]` | logs in to ECR, pushes (or keeps an existing tag), prints the digest |
| `run-indexer-image-locally.sh [cli\|lambda\|fargate\|all]` | runs the built image locally; no AWS |
| `build-app-release.sh` | builds the release bundle (server jar and JRE, static export, indexer and Node, Caddy) in a linux/arm64 container; writes `deploy/out/repohive-<sha>.tar.gz` and its SHA-256; no AWS; refuses uncommitted changes under `packages/`, `repohive-server/` or `deploy/box/` |
| `verify-release.sh [version]` | on Linux arm64: the bundle and the image compute the same snapshot inputs, the bundle's server starts on its own Java, answers `/healthz`, serves the viewer and has its pre-check child answer, the bundle's Caddy serves the viewer with the host mapping (`check-spa-mapping.mjs`) and validates its file; no AWS |
| `check-spa-mapping.mjs <caddy> <web root> [port]` | runs `deploy/box/spa.caddy` under any Caddy 2 binary and checks the host mapping of `packages/web/README.md` request by request against the static export |
| `upload-app-release.sh [version]` | uploads the bundle and its SHA-256 to the ops bucket |
| `deploy-app.sh [version]` | activates a release on the box through SSM Run Command (uploads it first if it was built here) |
| `rollback-app.sh` | switches the box to the previous release |
| `apply.sh <bootstrap\|main> [--plan-only\|--apply-saved\|--destroy-plan] [plan args]` | `init` and `plan -out` with every `-var` from `deploy.env`; prints and stops, applies the saved plan, or (no mode) asks for `apply` |
| `deploy.sh <build\|image\|infra [mode]\|app\|smoke\|all>` | the one deploy command; each stage runs alone; `infra` reads the image digest from ECR |
| `tf-output.sh <root> [name]` | prints a root's outputs from the account's state |
| `smoke.sh [repo]` | checks the live site through the site domain (healthz, the closed internal and admin doors, the viewer's pages, snapshot object headers from `/artifacts/`, closed `private/` and `backup/`, origin refusal); no AWS calls |
| `teardown.sh --confirm <account id>` | removes everything from an account whose `deploy.env` says `PROTECT=false` |
| `check.sh` | the offline checks: `terraform fmt -check`, `validate` and the offline plan test per root, `shellcheck`, `bash -n` |

The build runs in GitHub Actions (`.github/workflows/build.yml`) on `ubuntu-24.04-arm`, started only by those tags; it runs the
server's tests (`./mvnw -B verify`, Java 21) before it builds. Actions are pinned by commit: `actions/checkout` v7.0.1
(`3d3c42e5…`), `actions/setup-java` v6.0.1 (`de7274f0…`), `aws-actions/configure-aws-credentials` v6.3.0 (`e1253824…`). It assumes `repohive-github-build` (bootstrap root) through GitHub's OIDC provider; the role trusts only
`repo:<owner>/<repo>:environment:<account>` and can only push to `repohive/indexer` and put under `releases/`.

Offline checks (never reach AWS; clear AWS credentials first): `terraform fmt -check -recursive deploy/terraform`;
per root `terraform -chdir=<root> init -backend=false`, then `validate`, then `test`; `shellcheck` on every script under
`deploy/`. `deploy/scripts/check.sh` runs them all. The `test` step (`tests/plan.tftest.hcl` in each root) plans the
whole root with the real AWS provider, placeholder credentials and fixed values for the data sources that would call
AWS, and asserts cross-file contracts (user data under 16 KB, rendered state machine, no DynamoDB grant, the object
prefixes each role may write, the CloudFront behaviours, the S3 list grant). It cannot check what AWS validates server-side: the provider validates the state machine
definition by an API call at plan time, so the offline test skips that resource's plan and the first real plan
does it.

## Commands

Run from the repo root.

| Command | Effect |
|---------|--------|
| `npm run build` | `tsc -b packages/parser packages/core packages/engine packages/views packages/indexer`, then `node packages/views/scripts/write-views-version.mjs` (writes `packages/views/dist/views-version.json`) |
| `npm run typecheck` | **identical to `build`**, see below |
| `npm test` | `npm run test --workspaces --if-present` |
| `npm run parse -- <dir>` | parse a Java tree → `graph.json` |
| `npm run group -- <args>` | group `graph.json` → `index/` |
| `npm run demo:group-determinism` | repeated-run SHA-256 comparison |
| `npm run demo:baselines` | baseline comparison output |
| `npm run dev --workspace @repohive/web` | viewer on port 3000 (long-running; start it yourself). It proxies `/api`, `/artifacts` and `/healthz` to the server on 8080, so the server must be running |
| `npm run start-local --workspace @repohive/web` | starts the jar and `next dev` together (long-running; the user starts this). Needs the jar built first |
| `npm run build --workspace @repohive/web` | static export to `packages/web/out` |
| `npm run type-check --workspace @repohive/web` | `tsc --noEmit` for the viewer |
| `npm run e2e --workspace @repohive/web` | `scripts/e2e.mjs`: spawns the jar on a scratch data dir and runs the happy path, the limits and the system-failure refund. Needs the jar and the root build. Not part of `npm test` |

From `repohive-server/` (set `JAVA_HOME` to a JDK 21+ first; on Windows use `mvnw.cmd` or `./mvnw` from Git Bash):

| Command | Effect |
|---------|--------|
| `./mvnw -B verify` | compile, run the JUnit suite, build the jar. **The server's gate** |
| `./mvnw -B -DskipTests package` | build `target/repohive-server.jar` only |
| `java -jar target/repohive-server.jar` | run it from `repohive-server/`: it reads `config/local.env` and listens on 8080. Set `REPOHIVE_DATA_DIR` to a scratch directory to keep your dev data out of `.repohive-local`, and `REPOHIVE_WEB_DIR=../packages/web/out` to serve the exported viewer from it (long-running; the user starts this) |

**The root `typecheck` script is not a no-emit check.** It is
the same `tsc -b ...` followed by the same views-version script, byte-identical to `build`, so it writes `dist/`. Real no-emit checks live per package, under two
different names: `typecheck` (`tsc --noEmit`) in `shared`, `parser`, and `core`, but `type-check` in
`web`. There is no root script that runs it.

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
around the parser's CLI entry point, not the packaged CLI, which does not exist.

## Storage

**The engine's artifacts are JSON files on disk; the engine has no database.** The hosted application's state (accounts,
quota, sessions, the repository pointer, the job ledger) is one SQLite file owned by `repohive-server`, at
`<REPOHIVE_DATA_DIR>/app.sqlite` (locally `.repohive-local/data/app.sqlite`). Published snapshots live in an object
store: a directory (`.repohive-local/`) locally, S3 hosted. `graph.json` is **estimated** at roughly 10 to 20 MB for a 4k-file
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
