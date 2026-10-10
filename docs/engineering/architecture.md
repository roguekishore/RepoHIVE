# Architecture

System shape as built. Facts only.

## Pipeline

Three stateless stages that hand off through files on disk.

```
Java repo  →  [parse]  →  graph.json  →  [group]  →  index/*.json  →  [view]  →  browser
```

| Stage | Input | Output | Process model |
|-------|-------|--------|---------------|
| `parse` | a Java source tree | `graph.json` | batch; reads files, writes one file, exits |
| `group` | `graph.json` | `index/` (5 files) | batch; reads one file, writes five, exits |
| `view` | published snapshot views | browser | static export of the viewer; data from the Java server's JSON API and the published `artifacts/` objects |

`parse` internals: Tree-Sitter produces a per-file AST; the AST is held one file at a time and
discarded. Our stitcher resolves cross-file references and emits the graph. **ASTs are never
persisted.** `graph.json` is the artifact.

`group` internals: ingest → dependency strengths → region identification → structural-quality
assessment → adaptive preserve-vs-reconstruct construction → hierarchy assembly → metadata.

`index/` contents: `repository.json`, `hierarchy.json`, `nodes.json`, `edges.json`, `metadata.json`.
The list is enforced in `packages/core/src/index-serializer.ts`; the layout is below.

`graph.json` and `index/` are **git-ignored generated artifacts**. Reverting code does not restore the
artifacts that matched it; re-run the pipeline.

## The index format

Format **version 1**, the only one `parseIndex` reads. Constants and codes live in
`packages/core/src/index-format.ts`; payloads are built in `index-serializer.ts` (`indexFilePayloads`) and
read in `index-parser.ts`. Every file is **minified** JSON (keys sorted, no whitespace, one trailing newline)
and carries `"formatVersion": 1`. A missing or different version is an `UNSUPPORTED_FORMAT_VERSION` error
naming the file; there is no reader for the earlier pretty-printed layout (`compact-index-format-is-a-hard-cut`).

Every node id is stored **once**, in `hierarchy.json`'s `ids`, in canonical order (byte-wise, strictly
ascending). Everywhere else a node is its **position** in that array. `-1` (`ABSENT`) means "no value".

| File | Fields |
|------|--------|
| `repository.json` | `formatVersion`, `repositoryId` (the one place the root id is repeated, so the summary reads alone), `hierarchyDepth`, `nodeCount`, `edgeCount` |
| `hierarchy.json` | `formatVersion`, `root` (position of the repository node), `ids` (string[]), `nodes`: one row per id, `[kind, level, parent, children]` |
| `nodes.json` | `formatVersion`, `strings` (each attribute string once, in first-use order), `nodes`: one row per id, `[regionId, ordinal, packagePath, directoryPath, definedInFile]` |
| `edges.json` | `formatVersion`, `leaf`: rows `[source, target, importFrequency, methodCallFrequency, sharedTypeCount, strength]`, `cross`: rows `[source, target, level, weight]` |
| `metadata.json` | `formatVersion` plus the `Metadata` fields unchanged, except `regionDecisions[].groupIds` are positions |

Row details:

- `kind` is a code into `NODE_KIND_CODES`: `0` repository, `1` group, `2` file, `3` class, `4` function.
- `parent` is a position, `-1` on the root. `children` are positions, ascending (which is canonical id order).
- In `nodes.json`, `regionId`, `packagePath` and `directoryPath` are positions into `strings`; `definedInFile` is
  a node position; `ordinal` is the integer itself. Region provenance goes together: `regionId` and `ordinal`
  are both `-1` or both set. The row for a node that has no attributes is all `-1`.
- Leaf edges are in canonical edge order; cross-group edges in hierarchy order.
- `parseIndex` rebuilds the same `Hierarchy` and `Metadata` as before, ids and all: nothing downstream of it
  changed. Its checks (tree shape, ranges, counts across files) are the old ones, restated on positions.

Bump `INDEX_FORMAT_VERSION` on any change to a layout above or to the meaning of a code. It feeds
`engineVersion`, so a bump changes snapshot ids.

Broadleaf (29,190 nodes): 37.7 MB pretty-printed, 6.0 MB compact (measurements register).

## The JSON contract (stable seam)

The parser writes it; every other component reads it. Adding fields is safe; changing or removing them
is a breaking change. Defined in `packages/shared/src/contract.ts`.

```typescript
type NodeKind = "file" | "function" | "class" | "group" | "repository";

interface GraphNode { id; kind: NodeKind; packagePath?; directoryPath; definedInFile?; }
interface DependencyEdge { source; target; importFrequency; methodCallFrequency; sharedTypeCount; strength?; }
```

`NodeKind` has five members, but **the parser emits only `file`, `class`, and `function`**. `group` and
`repository` are produced downstream by the grouping algorithm. Likewise `strength` is part of the
contract but is never emitted by the parser; the downstream weight calculation populates it.

Field omission, not empty string or null, is how the contract expresses "no value": `packagePath` is
absent when there is no declared Java package, and `definedInFile` is absent on `file` nodes.

A graph carries at most one edge per ordered `(source, target)` pair. Signals between the same two
entities are summed into a single edge before emission. Two edges over one pair get double-counted by
consumers that sum strength, which can inflate cohesion enough to flip a preserve/reconstruct decision,
so the grouping engine rejects such a graph rather than silently folding it. The opposite direction is a
different pair and is legitimately distinct.

Group nodes additionally carry `regionId` and `ordinal`; each recorded decision carries `groupIds`.
Join a group to the decision that produced it through those fields. **Never re-derive the association
from a path or package-prefix heuristic** (that heuristic existed once and was removed).

Node identity is scoped by source root: `class`/`function` ids carry a `<sourceRoot>|` prefix, omitted
when the scope is empty so single-root ids are unchanged. This is what makes multi-module repos work.

## Packages

```
packages/
  shared/       JSON-contract types (the stable seam), chunked-output primitives
  parser/       Tree-Sitter Java → graph.json
  core/         grouping algorithm + blast radius
  engine/       parse then group in one call (`indexProject`), progress, snapshot-id inputs
  views/        the viewer's response bodies as pure functions of a parsed index (ecosystem)
  indexer/      the hosted indexing job: pre-check, tarball fetch, run, views, publish (ecosystem)
  web/          the viewer: a Next.js 15 static export, no server code (ecosystem)
repohive-server/  Spring Boot 3 / Java 21 server: accounts, quota, index requests, job ledger, dispatch
                  (ecosystem; Maven, not an npm workspace)
```

`shared` is the leaf dependency. `parser` and `core` depend only on `shared`; `engine` depends on
those three. Nothing in `shared`, `parser`, `core` or `engine` may import from `web`, `views`, `indexer`
or any later ecosystem package (a CLI, an MCP server), and none holds AWS, network or compression code
(`engine/src/boundary.test.ts` scans for it).

**Orchestration lives in `engine`.** `indexProject` runs `parseProject` then `groupGraphToIndexAsync`, writes
both artifacts under one output root, and returns the grouping output in memory. The parser and core still
do not import each other. `engineVersion` and `configDigest(options)` are what a snapshot id is built from.
The root `parse` and `group` npm scripts remain for running one stage alone.

**Views and the hosted job are ecosystem code.** `views` depends on `core` only (no Next.js, no React) and holds
the adapters and route logic that used to live in `web`; each route handler now parses its request and calls a
`views` function. Its `buildSnapshotViews(groupingOutput, entry)` builds every response a snapshot publishes at
index time, and `fromGroupingOutput` makes the in-memory output equal what `parseIndex` returns. `indexer`
depends on `engine`, `core` and `views`. It defines `ArtifactStore`, `JobReporter` and `SourceFetcher`, each with
a local implementation (directory or memory, memory, tarball file) and an AWS or network one (S3, HTTP to the
server, GitHub tarball), so the whole job runs offline. `runJob` is the one function the Lambda handler, the
Fargate entry point and the local child (`local-job.ts`) call; the container image and its start commands are in
`packages/indexer/DEPLOY.md`. The job holds **no state of its own**: it posts progress and exactly one outcome
(`succeeded`, `failed` or `retier`) to the server's internal API through `JobReporter` (`reporter-http.ts`), and
the server's database is the ledger (see "Server"). `precheck-cli.ts` prints the pre-check result as one JSON line
for the server to run as a child process.

**A hosted run parses tolerantly.** `hostedEngineOptions` sets `tolerateFileErrors`: a Java file that will not parse
(a template, a fuzz input, syntax newer than the grammar), or that repeats a class another file in the same source
root declares, is left out instead of failing the repository. For a repeated class the file first in canonical order
keeps it, so the result does not depend on input order. The run still fails if no file survives. The skipped files
come back on `ParseSuccess.skippedFiles`, and the job reports their count as `counts.skippedFiles` (omitted when
none) and logs a `files skipped` line with the first 20 paths. The server receives only node and edge counts, so the
skipped count is visible in the job result and the log, not in the ledger. The default for `parse` and `group`
outside the hosted job is unchanged: one unparseable file fails the run.

Published objects have URL-shaped keys. **Public and immutable:** `artifacts/<owner>/<repo>/<snapshotId>/`
(views and `manifest.json`; owner and repo lowercase). **Private**, outside anything the CDN serves:
`private/<owner>/<repo>/<snapshotId>/index/` (the index files) and `private/<owner>/<repo>/history.json`. There is
no pointer object; the active snapshot is `indexed_repositories.snapshot_id` in the server's database. The worker's
prune keeps the three most recent snapshots at least 24 h old and never prunes the one the server reports active
(`GET /api/internal/repos/<owner>/<repo>/active`; if that read fails the prune is skipped). The snapshot id hashes
the repository, commit, `engineVersion`, the views version and `configDigest`; it did not change when the key layout
did. The views version is a build-time hash of the `views` `dist/`, written by
`packages/views/scripts/write-views-version.mjs` after `tsc -b`.

## Server (`repohive-server/`)

Spring Boot 3 on Java 21, built with Maven (the wrapper is script-only, so no binary jar is committed). It owns all
application state in one SQLite database (Flyway migrations `V1` accounts and quota, `V2` repositories and jobs, `V3` runtime settings and their audit trail) and
serves the JSON API under `/api`, `/healthz`, and, in local mode, `/artifacts/**` and optionally the exported viewer
(`REPOHIVE_WEB_DIR`). Data access is plain JDBC (`JdbcTemplate`), not JPA, and there is no Spring Security: the cookie,
origin check, lockouts and scrypt (BouncyCastle) are written out to match the behaviour the Next.js server had.
Package layout under `com.repohive`: `controller` (HTTP), `service` (auth, quota, intake, jobs, reconciliation,
backup), `repository` (SQL), `dispatch`, `store`, `config`, `model`.

- **The job ledger is the table `job_executions`.** `status` (`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`) is the lock
  column; `state` is the fine-grained state the job API and SSE return. A partial unique index on `repo` where status
  is `QUEUED` or `RUNNING` allows one job in flight per repository. L and XL jobs run one at a time: the dispatcher
  starts one only when no L or XL job is `RUNNING`, and starts waiting ones in `created_at` order when the slot frees.
  A retier outcome goes back through the same slot logic, at most twice.
- **Dispatch** has two implementations of `DispatchService`: Step Functions `StartExecution` (hosted) and a local one
  that spawns the indexer's `local-job.js` as a child process. Execution names are `<jobId>`, `<jobId>-r<n>` and
  `<jobId>-s`.
- **Reconciliation** (`JobReconciliationService`, every 30 s) fails and refunds a `RUNNING` job whose execution ended
  without a completion call, restarts a never-started job once, and expires `QUEUED` jobs that wait past the slot
  timeout. This replaces the old state machine's decide-and-fail-open states.
- **Internal API**, `/api/internal/**`, bearer secret compared in constant time: `jobs/progress`, `jobs/complete`,
  `repos/<owner>/<repo>/active`. The secret is `REPOHIVE_INTERNAL_SECRET` locally and an SSM SecureString hosted.
- **Runtime limits.** Six limits are changeable while the server runs: the four quota values, the cap on queued or
  running jobs across all accounts, and sign-ups per IP per day. `RuntimeLimits` is the one place services read them
  (`QuotaService`, `IntakeService`, `AccountService` call `current()` per decision). The environment
  (`REPOHIVE_QUOTA_*`, `REPOHIVE_GLOBAL_INFLIGHT_CAP`, `REPOHIVE_SIGNUP_IP_DAY`) gives the defaults; a value saved in the
  `settings` table overrides its default, survives restarts, and is cached for 5 s (a save refreshes the cache at once).
  `GET` and `PUT /api/admin/limits` read and change them: a separate bearer token (`REPOHIVE_ADMIN_TOKEN`, or
  `REPOHIVE_ADMIN_TOKEN_PARAMETER` for an SSM SecureString; at least 24 characters, and never the internal secret),
  no session, no origin guard. Without a token every method answers 404. `REPOHIVE_ADMIN_ORIGINS` (exact origins,
  default none) is the CORS allow-list for a browser page; any other cross-origin call gets 403. A `PUT` takes
  `{"limits": {<key>: <integer or null>}}`: a number above a limit's maximum is clamped to it and reported in
  `clamped`, null removes the override, anything invalid (below 1, not an integer, unknown key) rejects the whole
  request, and each real change writes a row to `settings_audit` (old and new value, time, caller's address). The
  page for it is the single file `repohive-server/admin/quota.html`, hosted by the owner, not by the server. Routing
  consequence for `deploy/`: the CDN and Caddy must pass `OPTIONS` and `PUT` on `/api/admin/*`, forward
  `Authorization`, and not cache `/api/*`.
- **Benchmark accounts.** `PUT /api/admin/bench` (`{"email", "hours"}`, 1 to 72, default 12) flags an account until a
  time; `DELETE /api/admin/bench?email=` ends it; `GET /api/admin/bench` lists the flags and the audit trail;
  `GET /api/admin/bench/accounts?q=` finds accounts (the page's picker). Same token and CORS as the limits (`V4`,
  `BenchAccounts`). While flagged, an account skips the per-account and per-IP pre-check and index quotas, the one
  index in flight per account, and the global in-flight cap; its charges are filed under the address `bench` so they do
  not use up the quota of ordinary users on the same address. The flag ends by itself. Everything else still applies:
  the pre-check, one job per repository, the L and XL slot, Lambda and Fargate capacity, the GitHub token's budget, and
  Caddy's per-IP rate limits. A harness should poll `GET /api/jobs/<id>`, not open an event stream per lane (five per
  address).
- **Pre-check stays TypeScript.** `ProcessPrecheckRunner` runs `packages/indexer/dist/precheck-cli.js` under Node
  (`REPOHIVE_NODE`, `REPOHIVE_INDEXER_DIR`), because the pre-check depends on the parser's selection policy and on
  `engineVersion`, and a Java port could drift. The box therefore keeps a Node runtime.
- Cache hits are decided by the server: the pre-check's snapshot id equals `indexed_repositories.snapshot_id`.
- Configuration is validated at start from environment variables (`AppConfigFactory`); the error names the variable
  and never echoes a value. Locally they come from `repohive-server/config/local.env`.

The request contract, the object layout and the job lifecycle are specified in the server's design document
(`context/specs/redesign/`); where it disagrees with the code, the code and then the contract win.

## Web app (`packages/web`)

One Next.js 15 package holds the viewer and nothing else: **a static export** (`output: "export"`), with no route
handlers, no database and no server code. Accounts, quota, index requests and jobs are the Java server's.

```
src/
  app/          routes only: pages and layouts
  components/   ui/ (Radix primitives), layout/ (navigation, theme), shared/ (page shell, loading state, table)
  features/     one folder per surface; see below
  lib/          small client helpers: cn, theme tokens, site origin
  views/        tests of the @repohive/views adapters
  styles/       globals.css (design tokens) and the token drift test
scripts/        start-local.mjs (local launcher), e2e.mjs (end-to-end script against the jar)
```

`features/`: `structure-map` (the knowledge-graph page's canvas engine, panels and blast-radius worker),
`hierarchy`, `decisions` (the shared decision model and marks, with the audit page's parts), `architecture`,
`adaptivity`, `flat-baseline` (a purpose-built Sigma view of `views/graph.json`), `repository` (URL parsing, the
snapshot session, breadcrumb, repository list), `jobs` (the public job shape) and `account` (sign-in and sign-up,
index request, quota dialog).

Pages: `/` (dashboard and index request), `/auth/sign-in`, `/auth/sign-up`, `/jobs/[jobId]`, and the seven
repository views under `/repos/[owner]/[repo]/`: `knowledge-graph` (the structure map), `hierarchy`,
`decision-audit`, `architecture`, `circles`, `flat-baseline`, `adaptivity`. `/repos/[owner]/[repo]` redirects to the
structure map and the repository is lowercased in the URL; both happen **in the client** now (the old middleware is
gone).

A static export cannot pre-render arbitrary owners, repositories or job ids. Each dynamic route exports one
placeholder shell (`_`), and **the host maps `/repos/<owner>/<repo>[/<surface>]` and `/jobs/<jobId>` to those
shells**; the browser path supplies the real values. The mapping, and the rules that keep it identical across hosts,
are in `packages/web/README.md` ("Static export and host mapping"). Three hosts apply it: the Java server's local mode
(`REPOHIVE_WEB_DIR`), `next dev` (rewrites, development only) and Caddy on the box (a deploy follow-up, not yet done).

The repository views do not read `index/`. They call `GET /api/repos/<owner>/<repo>` once per page session (served
`no-store` by the server) to learn the active snapshot id, then fetch
`/artifacts/<owner>/<repo>/<snapshotId>/views/*.json`, which `packages/views` built at index time. `?snapshot=<id>`
pins a snapshot, checked against its `manifest.json`. Objects under `artifacts/` are public and immutable by design.
Layout is computed client-side; the blast-radius traversal runs in a Web Worker over `views/blast-radius.json`.

Two long-standing descriptions of the renderer are recorded here but **not confirmed against the
current code**: that the per-level node budget is about 20, and that client-side layout is
deterministic (sorting by sibling rank, ties broken by id). Treat both as claims to re-derive before
relying on them.

## Engine / ecosystem boundary

- **Engine:** `parser`, `core`, `shared` are the parse/group/blast-radius logic.
- **Ecosystem:** `web`, `views`, `indexer`, `repohive-server` (Java; it reaches TypeScript code only by running the
  indexer's compiled CLIs as child processes, and by HTTP from the workers), and any future CLI, MCP server or editor
  extension.

Ecosystem code may depend on engine code. **Engine code may never depend on ecosystem code.** Every
change belongs clearly on one side of this line.

This rule currently holds. A grep for imports of `@repohive/web`, `views` or `indexer`
across `packages/{parser,core,shared}/src` returns nothing, and neither `parser` nor `core` imports the
other. The only cross-package imports in engine source are 51 references to `@repohive/shared`.

## Repository layout

Tracked at the repository root:

```
packages/            see above
repohive-server/     the Java server (Maven; `mvnw` wrapper, `config/local.env` for local runs)
fixtures/            sample-java-project (its sources are tracked even though .gitignore lists it;
                     its generated graph.json and index/ are ignored)
deploy/              AWS deployment as code (Terraform, box files, scripts, runbook); not a workspace
docs/engineering/    these documents
tsconfig.base.json   shared compiler options
components.json      shadcn component configuration
LICENSE / NOTICE     AGPL-3.0-or-later plus upstream attribution
README.md
.editorconfig
```

Code derived from upstream (repowise) is not a separate top-level directory. It lives in `packages/web`, with
attribution in `NOTICE`.

Deliberately absent from the public repository, all git-ignored: `context/` (project state, decision
history, and registers; see below), `tooling/`, `archive/`, `node_modules/`, `dist/`,
`graph.json`, and `index/`.

`context/` is a private mount, not part of this repository:

```
context/STATE.md      current project state (the only file read every session)
context/decisions/    decision history
context/registers/    the large registers
```

A contributor working from a public clone will not have `context/`. Anything that depends on it is
optional by construction. `docs/engineering/` is the durable, public half and must stand on its own.

## Deploy tree (`deploy/`)

`deploy/` holds everything needed to run the hosted stack on AWS (ap-south-1), as code. It is **not an npm
workspace and no package imports it**; it reaches `packages/indexer` and `packages/web` only by building them
(the indexer image, the app release bundle), never by importing.

> **The deploy tree has not caught up with the redesign.** Everything below describes `deploy/` as it is, which is
> the design that was deployed to the test account: the DynamoDB ledger, the control Lambda, the ~30-state state
> machine, the `s/*` and `r/*` CloudFront behaviours, and a box that runs the Next.js server and a worker. The code
> no longer matches it: the server (`repohive-server`) replaces the box's Next.js server and worker, the ledger and
> control code are gone from `packages/indexer`, and the keys moved to `artifacts/`. Until the follow-up list in
> `context/specs/redesign/progress.md` ("Deploy follow-up", 12 items) is done, **a release built from this code
> cannot be deployed with this tree.** `ledger-table.ts`, `control.ts` and `packages/web/src/server/` named below no
> longer exist.

```
deploy/terraform/bootstrap/   applied once per account, local state: state bucket, ops bucket, ECR, CloudFront
                              certificate, GitHub OIDC build role
deploy/terraform/main/        the stack; state in the account's state bucket (S3 native locking)
deploy/box/                   Caddyfile, systemd units, CloudWatch agent config, cloud-init, release Dockerfile
deploy/scripts/               bash deploy scripts
deploy/accounts/<name>/       one folder per AWS account (git-ignored): deploy.env, bootstrap state, plans
deploy/RUNBOOK.md             the step-by-step
.github/workflows/build.yml   builds and tests the image and the release on arm64, started only by a pushed tag
```

The same tree deploys into any number of accounts. Everything account-specific lives in that account's folder and is
passed to Terraform as variables; resource names are fixed within an account or derived from its id, so two accounts
never collide, except on the site domain, which CloudFront allows on one distribution only.

Every file under `deploy/` is LF (`deploy/.gitattributes`): it runs on Linux. Names derived from the account id
are built once in `deploy/terraform/main/locals.tf`. Engine packages stay free of AWS code.

The ledger table is described twice and a test keeps the two equal: `deploy/terraform/main/ledger-schema.json` (Terraform reads it) and `LEDGER_TABLE_LAYOUT` in `packages/indexer/src/ledger-table.ts` (what the DynamoDB `JobLedger` relies on; `ledger-table.test.ts`). The table has a string partition key `pk`, no sort key, no secondary index, and TTL on `expiresAt`. Secrets are SSM SecureString parameters under `/repohive/`; the indexer's Lambda entry points read the GitHub token from `REPOHIVE_GITHUB_TOKEN_PARAMETER` once per cold start (`src/github-token.ts`).

The same image also holds the control handler (`packages/indexer/src/control.ts`, `dist/control.handler`), which the state machine calls for ledger operations (`acquireSlot`, `releaseSlot`, `inspect`, `failIfOpen`) so the definition never duplicates the table layout. It reads only `REPOHIVE_LEDGER`. Taking the large slot is re-entrant for the job that already holds it and renews its lease in every ledger implementation (shared contract test).

The state machine `repohive-index` (`deploy/terraform/main/state-machine.asl.json`, Standard, JSONata) routes S and M to the Lambda function and L and XL to Fargate, takes the large slot through the control function, and decides every outcome from the ledger rather than from the runtime's exit status: after each run it calls `inspect`, re-routes a `retier` (twice at most), runs a job the runtime never started once more, and calls `failIfOpen` for anything not terminal. The app starts executions named after the job id (`packages/web/src/server/orchestrator/sfn.ts`), and an EventBridge rule on executions ending FAILED, TIMED_OUT or ABORTED calls `failIfOpen` with that name. `packages/indexer/src/state-machine.test.ts` reads the ASL file and keeps its structure, retries and timeouts honest.

The app box (`deploy/terraform/main/box.tf`, `deploy/box/`) is a t4g.small running three systemd services behind CloudFront: Caddy (TLS for the origin domain by HTTP-01, 403 without the origin secret header, the right-most `X-Forwarded-For` address as `X-RepoHIVE-Client-IP`), the Next.js standalone server on `127.0.0.1:3000`, and the background worker. SQLite lives on a separate encrypted volume at `/var/lib/repohive`. Secrets never enter user data: `repohive-env` renders `/run/repohive/*.env` from `/etc/repohive/box.env` and the SSM parameters at start. A release is one tarball built in a linux/arm64 container (`Dockerfile.release`): the standalone server, the worker's `scripts/` and `src/`, production `node_modules` with the workspace packages the server loads at run time copied in as real directories (`next.config.ts` leaves them out of the bundle; `deploy/box/verify-app-tree.sh` checks this), the Node binary, Caddy built by `xcaddy`, and the units, agent configuration and scripts. `repohive-activate` unpacks it, switches `/opt/repohive/current`, restarts the units, polls `/healthz` and switches back if it does not answer. Cloud-init runs once; everything else ships with the next release.

One CloudFront distribution serves the site domain (`cloudfront.tf`). `/s/*` and `/r/*` go to the artifact bucket through an Origin Access Control with a path-only cache key, so the stored `Cache-Control` decides lifetime; `/_next/static/*`, `/api/jobs/*` (uncached, uncompressed, for server-sent events) and everything else go to the box through `origin.<site domain>`, with the origin secret in `X-RepoHIVE-Origin-Secret`. The bucket policy lets only that distribution read `s/` and `r/`; `idx/`, `meta/` and `backup/` have no behaviour. Eight alarms (`alarms.tf`) email one SNS topic, a budget emails the owner, and a systemd timer on the box writes a `SiteUp` metric line every minute that backs the heartbeat alarm.
