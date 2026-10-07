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
| `view` | `index/` | HTTP + browser | long-running Next.js server |

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
  web/          Next.js 15 app: the six repository views, accounts, index requests, the worker (ecosystem)
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
depends on `engine`, `core` and `views`. It defines `ArtifactStore`, `JobLedger` and `SourceFetcher`, each with
a local implementation (directory or memory, memory or file, tarball file) and an AWS or network one (S3,
DynamoDB, GitHub tarball), so the whole job runs offline. `runJob` is the one function both the Lambda handler and
the Fargate entry point call; the container image and its start commands are in `packages/indexer/DEPLOY.md`.
Published objects have URL-shaped keys under `s/<snapshotId>/` (public, immutable), `r/github.com/<owner>/<repo>/`
(the `latest.json` pointer) and non-public `idx/` and `meta/`; the snapshot id hashes the repository, commit,
`engineVersion`, the views version and `configDigest`. The views version is a build-time hash of the `views`
`dist/`, written by `packages/views/scripts/write-views-version.mjs` after `tsc -b`.

## Web app (`packages/web`)

One Next.js 15 package holds the viewer, the account and index-request routes, and the background worker. The
UI components and types that used to be separate packages live inside it.

```
src/
  app/          routes only: pages and route handlers
  components/   ui/ (Radix primitives), layout/ (navigation, theme), shared/ (page shell, loading state, table)
  features/     one folder per surface; see below
  lib/          small client helpers: cn, theme tokens, site origin
  server/       app-db (SQLite), auth, quota, intake, jobs, orchestrator, worker, hosting (config, clients),
                telemetry, health, repositories, views (adapter tests)
  styles/       globals.css (design tokens) and the token drift test
```

`features/`: `structure-map` (the knowledge-graph page's canvas engine, panels and blast-radius worker),
`hierarchy`, `decisions` (the shared decision model and marks, with the audit page's parts), `architecture`,
`adaptivity`, `flat-baseline` (a purpose-built Sigma view of `views/graph.json`), `repository` (URL parsing, the
snapshot session, breadcrumb, repository list) and `account` (sign-in and sign-up, index request, quota).

Pages: `/`, `/request`, `/quota`, `/auth/sign-in`, `/auth/sign-up`, `/auth/sign-out`, `/jobs/[jobId]`, and the six
repository views under `/repos/[owner]/[repo]/`: `knowledge-graph` (the structure map), `hierarchy`,
`decision-audit`, `architecture`, `flat-baseline`, `adaptivity`. The middleware redirects `/repos/[owner]/[repo]`
to the structure map and lowercases the repository in the URL.

Route handlers: `/api/auth/{session,sign-in,sign-up,sign-out}`, `/api/index`, `/api/jobs/[jobId]` and
`/api/jobs/[jobId]/events`, `/api/quota`, `/healthz`, and `/r/*` and `/s/*`, which serve published snapshot objects
from the local store in local mode (CloudFront serves them from the artifact bucket when hosted).

The repository views do not read `index/`. They resolve one snapshot per page session from
`/r/github.com/<owner>/<repo>/latest.json` and then fetch `/s/<snapshotId>/views/*.json`, which `packages/views`
built at index time. Snapshot objects under `s/` are public and immutable by design. Layout is computed
client-side; the blast-radius traversal runs in a Web Worker over `views/blast-radius.json`.

Two long-standing descriptions of the renderer are recorded here but **not confirmed against the
current code**: that the per-level node budget is about 20, and that client-side layout is
deterministic (sorting by sibling rank, ties broken by id). Treat both as claims to re-derive before
relying on them.

## Engine / ecosystem boundary

- **Engine:** `parser`, `core`, `shared` are the parse/group/blast-radius logic.
- **Ecosystem:** `web`, `views`, `indexer`, and any future CLI, MCP server or editor extension.

Ecosystem code may depend on engine code. **Engine code may never depend on ecosystem code.** Every
change belongs clearly on one side of this line.

This rule currently holds. A grep for imports of `@repohive/web`, `views` or `indexer`
across `packages/{parser,core,shared}/src` returns nothing, and neither `parser` nor `core` imports the
other. The only cross-package imports in engine source are 51 references to `@repohive/shared`.

## Repository layout

Tracked at the repository root:

```
packages/            see above
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
