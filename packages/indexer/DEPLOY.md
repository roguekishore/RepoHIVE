# Deploying the indexer image

What the deploy needs to run `packages/indexer` on AWS. Nothing here has been run against AWS: the job is
proved locally (`npm run job`, see below) and the AWS parts are written against mocked SDK clients.

## Build

From the repository root (the Docker context is the whole workspace; `Dockerfile.dockerignore` filters it):

```
docker buildx build --platform linux/arm64 --provenance=false -f packages/indexer/Dockerfile -t repohive-indexer .
```

- Docker 25 or later with buildx is required by the AWS Lambda base images.
- `--provenance=false` is required: Lambda rejects an image carrying a provenance attestation.
- The base image is `public.ecr.aws/lambda/nodejs:24` (Amazon Linux 2023). The AWS Lambda Node.js image page lists
  runtime deprecation for 2028-04-30.
- The image holds `dist/` and production `node_modules` only, unbundled, with no git. The Java grammar and the
  tree-sitter runtime are WebAssembly files resolved from `node_modules` at run time; that is why the image is not
  bundled (`docs/engineering/stack.md`).
- **Not built here.** When this was written Docker's daemon was not running, so the image build and the one local
  run were not done. Build and run it first.

## One image, two starts

| Runtime | Start | Heap |
|---------|-------|------|
| Lambda (S and M) | the image default, `CMD ["dist/lambda.handler"]` | `NODE_OPTIONS=--max-old-space-size=2400`, set in the image |
| Fargate (L and XL) | task definition `entryPoint: ["node"]`, `command: ["dist/fargate.js"]` | override `NODE_OPTIONS=--max-old-space-size=13000` |

`dist/fargate.js` is relative to `LAMBDA_TASK_ROOT` (`/var/task`, the image's working directory).

**The Fargate entry point must be set in the task definition.** The base image's entry point,
`/lambda-entrypoint.sh`, starts the Lambda runtime interface emulator when it runs outside Lambda, so a `command`
override alone does not start the job. `entryPoint: ["node"]` bypasses the script.

Both heap values are configuration, not code: change `NODE_OPTIONS` in the function or task definition. The heap
defaults are assumptions, to be measured after ship.

## Configuration (environment variables, validated at start)

| Variable | Value |
|----------|-------|
| `REPOHIVE_RUNTIME` | `lambda` (set in the image), `fargate` or `local` |
| `REPOHIVE_STORE` | `s3:<bucket>` (or `local:<dir>` for a local run) |
| `REPOHIVE_LEDGER` | `dynamodb:<table>` (or `memory`, `file:<path>`) |
| `REPOHIVE_GITHUB_TOKEN` | the server-side token; required outside `local`; never logged |
| `AWS_REGION` | set by the platform; required for `s3:` and `dynamodb:` |
| `REPOHIVE_JOB_INPUT` | Fargate only: the job input as JSON |
| `REPOHIVE_TIME_LIMIT_MS` | Fargate only: the task's time limit; the job aborts 30 s before it |

A bad or missing value stops the process before any job state exists, naming the variable and never echoing a secret.

## Job input and result

The Lambda event, and `REPOHIVE_JOB_INPUT` on Fargate, is one JSON object:

```json
{ "jobId": "...", "accountId": "...", "repo": "github.com/<owner>/<repo>", "commitSha": "<40 hex>",
  "tier": "S|M|L|XL", "snapshotId": "<32 hex>", "visibility": "public" }
```

The intake must have claimed the job in the ledger already (`queued`); the job moves it through the states and always
writes the final state. The snapshot id is recomputed by the job and must match: build the image and the intake from
the same commit.

- Lambda returns the result; Fargate exits `0` for `succeeded` and `retier`, `1` for `failed`.
- Both write the final result to the ledger; the app reads Fargate's result from there.
- A `retier` result sends the job back to `queued` with the new tier recorded; the app starts it on the new tier's
  runtime.

## What the job needs

- **S3** on the one bucket: `PutObject`, `GetObject`, `ListBucket`, `DeleteObject` (the prune). No bucket versioning
  and no object tags are used; ownership and cost tags belong on the bucket. `ListBucket` must cover the whole bucket,
  with no `s3:prefix` condition: otherwise a `GetObject` on a missing key (a first pre-check's `latest.json`, a first
  publish's `history.json`) answers 403 instead of 404, and the store reports it as an error. `ListBucket` must cover the whole bucket,
  with no `s3:prefix` condition: otherwise a `GetObject` on a missing key (a first pre-check's `latest.json`, a first
  publish's `history.json`) answers 403 instead of 404, and the store reports it as an error.
- **DynamoDB** on the one table: `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`. Partition key `pk` (string), no sort
  key, TTL attribute `expiresAt` (epoch seconds). Records: `JOB#<jobId>` (the job), `REPO#<repo>` (the per-repository
  lock, created with `attribute_not_exists(pk)`), `INFLIGHT` (the in-flight counter, incremented under a cap) and
  `SLOT#large` (the large-slot lease).
- Outbound HTTPS to `api.github.com` and `codeload.github.com` (the tarball redirect).
- The libuv thread pool is sized to the vCPU count by the entry points themselves; nothing to configure.
- Telemetry goes to stdout as CloudWatch embedded metric format in the namespace `RepoHIVE/Hosted`; the log group's
  metric extraction is on by default for Lambda and needs the awslogs driver on Fargate.

## Run it locally instead

```
npm run build
node packages/indexer/dist/cli.js --tarball <repo.tar.gz> --repo <owner>/<repo> --commit <40 hex> --store <dir>
```

The tarball comes from `git archive --format=tar.gz --prefix=<owner>-<repo>-<sha>/ <ref>`. The pre-check's GitHub calls
are stubbed from the tarball; the store is a directory and the ledger is in memory (or `--ledger <file.json>`).
