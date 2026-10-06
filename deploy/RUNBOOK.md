# RepoHIVE deploy runbook

How the hosted stack is deployed into an AWS account (ap-south-1), verified, operated and torn down. The same steps
deploy into any account: each account has its own folder `deploy/accounts/<name>/`, and every command names it with
`REPOHIVE_ACCOUNT=<name>`. The intended order is a **test account first** (an older account with credits,
`PROTECT=false`), then the **production account** (`PROTECT=true`).

**What is deployed** (`docs/engineering/architecture.md`): one `t4g.small` box runs Caddy, which serves the
exported viewer from disk and passes `/api/*` and `/healthz` to the Spring Boot server (`repohive-server`, its own Java
runtime from the release bundle). The server owns accounts, quota, the jobs ledger and the active snapshot in SQLite on
the data volume, runs the pre-check as a Node child process, and starts one Step Functions execution per run. The state
machine only routes by tier and runs: the indexer Lambda function (S and M) or a Fargate task (L and XL). The workers
report progress and the outcome to the server over HTTPS (`/api/internal/**`, a bearer secret in SSM). Snapshot objects
are served by CloudFront straight from the bucket (`/artifacts/*`). There is no DynamoDB table, control function or queue.

Every step gives **Command**, **Success** and **If it fails**. An agent can run every command; the steps marked
**Owner** need a person (a console, an email, a DNS provider, a secret). Scripts live in `deploy/scripts/`; each one
that calls AWS stops unless `aws sts get-caller-identity` matches the account's `deploy.env`. The first plan and apply
against AWS are the first real test of the Terraform: Section 17 says what was and was not run. Where a step fails,
stop and read the message; do not re-run an apply to "see if it works".

## Contents

1. Prerequisites
2. The account and its credentials
3. Quotas
4. The domain
5. Bootstrap and the certificate
6. The GitHub token
7. The build (GitHub Actions)
8. The main apply, DNS and the first alarms
9. The app release and the smoke test
10. First indexes
11. Operating
12. Post-ship measurement
13. Re-reading the prices
14. Teardown
15. Known risks
16. Default alarm thresholds
17. What has and has not been run

## 1. Prerequisites

- Terraform 1.11 or later (developed on 1.16.2), AWS CLI v2, `git`, `jq`, `curl`, and the GitHub CLI `gh` logged in as
  an administrator of the repository (`gh auth status`). Docker is **not** needed: the image and the release are built
  in GitHub Actions on arm64 (Section 7).
- **Shell.** The scripts are bash. On Windows, Git Bash works for every script here (all were run from it); WSL 2 works
  too. Box files must keep LF line endings (`deploy/.gitattributes` enforces it).
- **Provider lock files cover `windows_amd64` only**. On Linux or macOS, add your platform once
  per root before the first `init`: `terraform -chdir=deploy/terraform/<root> providers lock -platform=linux_amd64` (or
  `darwin_arm64`, `linux_arm64`). Do not commit the changed lock files unless you mean to.
- **The branch must be on GitHub** (`git push -u origin <branch>`): the build runs from a pushed commit.

**Command:** `terraform version && aws --version && jq --version && gh auth status && deploy/scripts/check.sh`
**Success:** every tool prints a version, and `check.sh` ends `0 failed` (a missing `shellcheck` shows as "not run").
**If it fails:** install the missing tool.

## 2. The account and its credentials

1. **Owner: credentials.** Create an access key for the account (the owner chose the root user's key and accepted the risk;
   an IAM user with AdministratorAccess works the same) and put it in `~/.aws/credentials` under the profile
   `repohive`, by hand, so no agent sees it:

   ```
   [repohive]
   aws_access_key_id = ...
   aws_secret_access_key = ...
   ```

   Every script uses the profile `repohive` unless `AWS_PROFILE` names another. To switch accounts, replace the two lines
   (or keep one profile per account and set `AWS_PROFILE`). Keep MFA on root, and delete the key when you are done with it.
2. **The account folder.** `mkdir -p deploy/accounts/<name>` and copy `deploy/deploy.env.example` to
   `deploy/accounts/<name>/deploy.env`. Fill in the account id, the site domain (Section 4), `OWNER_TAG`, `ALERT_EMAIL` and
   `PROTECT` (`false` for the test account, `true` for production). If the account already has a GitHub OIDC provider
   (IAM, Identity providers, `token.actions.githubusercontent.com`), set `GITHUB_OIDC_PROVIDER_ARN` to it.
3. **Owner, production account only:** note the date six months after the account was created if it is on the Free plan
   (the plan closes the account then unless moved to the Paid plan; data is deleted 90 days later). After the bootstrap
   apply, activate the cost allocation tags `Project`, `Environment`, `ManagedBy`, `Owner`, `CostCenter` in Billing.

**Command:** `aws sts get-caller-identity --profile repohive --query Account --output text`
**Success:** prints the account id in `deploy.env`.
**If it fails:** the profile is missing or its key is wrong; if the id differs, you are in the wrong account: stop.

## 3. Quotas

The server's global in-flight cap (default 5; changed at run time on the limits page, Section 6) must fit under Lambda's
concurrency limit, which every other function in the account shares; a 3,008 MB function must be allowed; Fargate needs
8 vCPU for one L or XL run.

```
aws --profile repohive --region ap-south-1 lambda get-account-settings --query AccountLimit
aws --profile repohive --region ap-south-1 service-quotas list-service-quotas --service-code fargate \
  --query "Quotas[?contains(QuotaName, 'vCPU')].[QuotaName,Value]" --output table
```

**Success:** `ConcurrentExecutions` minus what other functions use is at least 5; Fargate On-Demand vCPU at least 8.
**If it fails or is short:**

- Concurrency short: lower the in-flight cap on the limits page, or request an increase (`aws service-quotas
  request-service-quota-increase`). The function has no reserved concurrency on purpose.
- The 3,008 MB memory setting is refused at the first apply: put `lambda_memory_mb = 2048` in
  `deploy/accounts/<name>/main.tfvars` and lower the image's `NODE_OPTIONS` heap before indexing M repositories.
- Fargate vCPU below 8: `fargate_cpu_units = 4096` and `fargate_memory_mb = 8192` in `main.tfvars`; L and XL runs are slower.

## 4. The domain

Choose the **site domain**: `repohive.dev` or a name under it. The origin domain is `origin.<site domain>`. DNS stays in
Netlify DNS and every record is added by hand. **A name can be on only one CloudFront distribution in the world**, so
the test account and production need different names while both exist (for example `test.repohive.dev` and
`app.repohive.dev`), or the test account is torn down (Section 14) before production takes its name.

**Owner checks:**

1. In Netlify, confirm no site currently serves the chosen name.
2. `dig CAA repohive.dev +short` returns nothing, or records allowing both `amazon.com` and `letsencrypt.org`. If not,
   add `0 issue "amazon.com"` and `0 issue "letsencrypt.org"`.

## 5. Bootstrap and the certificate

The bootstrap root creates the state bucket, the ops bucket, the ECR repository, the CloudFront certificate (us-east-1),
the GitHub OIDC provider and the build role `repohive-github-build`. Its state is local:
`deploy/accounts/<name>/bootstrap.tfstate`.

**Command:**

```
REPOHIVE_ACCOUNT=<name> deploy/scripts/apply.sh bootstrap --plan-only     # prints the plan and a summary
REPOHIVE_ACCOUNT=<name> deploy/scripts/apply.sh bootstrap --apply-saved   # after the owner has read it and said go
```

(`apply.sh bootstrap` without a mode plans and asks for `apply` at the terminal.)

**Success:** the apply ends with outputs. **Back up `deploy/accounts/<name>/bootstrap.tfstate`** somewhere private: it is the
only record of these resources.
**If it fails:** an `allowed_account_ids` error means the profile and `deploy.env` disagree. `EntityAlreadyExists` on the OIDC
provider means the account has one: set `GITHUB_OIDC_PROVIDER_ARN` (Section 2) and plan again. A bucket-name clash means the
id is wrong (names derive from it).

**Owner: certificate validation.**

```
REPOHIVE_ACCOUNT=<name> deploy/scripts/tf-output.sh bootstrap certificate_validation_records
```

Add each CNAME in Netlify DNS (enter the name without the `repohive.dev` suffix if Netlify shows it doubled), then wait:

```
aws --profile repohive --region us-east-1 acm describe-certificate --certificate-arn <certificate_arn> \
  --query Certificate.Status --output text
```

**Success:** `ISSUED`. The main apply fails clearly until it is.

## 6. The GitHub token

**Owner:** create a **fine-grained personal access token**: resource owner your account, **public repositories read-only,
no other permission**, the longest expiry you accept, and note the expiry. Store it:

```
REPOHIVE_ACCOUNT=<name> deploy/scripts/put-github-token.sh                 # prompts; input hidden
REPOHIVE_ACCOUNT=<name> deploy/scripts/put-github-token.sh <token-file     # or from a one-line file you then delete
```

**Success:** `Stored /repohive/github-token`. **Rotate it:** run the same command, then restart the box's units
(`deploy.sh app` re-activates the current release, which restarts them). New Lambda and Fargate runs pick it up.

**The admin token and the limits page (owner, optional).** The server's quota, in-flight cap and sign-up limits can be
changed while it runs, and one account can be flagged as a benchmark account, from the owner-hosted page
`repohive-server/admin/quota.html` (it takes the server's address as input and keeps the token for the session only).
The API behind it, `/api/admin/**`, is **off until a token exists**: the server answers 404 for it. Store one, once the
box is up:

```
REPOHIVE_ACCOUNT=<name> deploy/scripts/put-admin-token.sh --generate      # run it yourself: it shows the token once, on a terminal
REPOHIVE_ACCOUNT=<name> deploy/scripts/deploy.sh app                      # the server reads the token when it starts
```

(`--generate` refuses to run where its output is not a terminal, so an agent never receives the token. Without it the
script prompts, or reads a one-line file; at least 24 characters, and not the internal secret.) A browser may call the
API only from the origins in `admin_origins` (`deploy/accounts/<name>/main.tfvars`, for example
`admin_origins = ["https://hivequota.themaverick.tech"]`, then `deploy.sh infra`); with none listed only non-browser
callers can. CloudFront already passes every method and the `Authorization` header on `/api/*` and never caches it.
**Rotate it:** the same command again, then `deploy.sh app`. Every change is audited with the caller's address. There is
no lockout for wrong tokens: Caddy's per-IP rate limit is the only brake.

## 7. The build (GitHub Actions)

`.github/workflows/build.yml` runs the server's tests (`./mvnw -B verify`, Java 21), builds the indexer image and the app
release **natively on arm64** from one commit, tests the bundle against the image (`verify-release.sh`: the snapshot
inputs match; the server starts with the bundle's own Java, answers `/healthz`, serves the viewer and has its pre-check
child answer a request; the bundle's Caddy serves the viewer with the host mapping, request by request; Caddy validates
its file and has both modules), and pushes the image to the account's ECR and the bundle to its ops bucket. It runs only
when a tag is pushed: `build-<account>-<sha>` (build, test, publish) or `verify-<sha>` (build and test, no AWS). Nothing
else starts it, and nothing goes to `main`.

It reaches AWS through the role `repohive-github-build` (Section 5), which trusts only this repository's GitHub environment
`<account>`. That environment admits only `build-<account>-*` tags and holds the variables `AWS_ACCOUNT_ID` and
`SITE_DOMAIN`; `build-in-github.sh` creates or updates it each time. No AWS key is stored in GitHub; the workflow masks the
account id in its logs (the repository is public).

**Command** (from the commit you want to deploy, committed and pushed):

```
REPOHIVE_ACCOUNT=<name> deploy/scripts/deploy.sh build
```

**Success:** `build build-<name>-<sha>: ok`, and the run's summary names the image digest and `releases/repohive-<sha>.tar.gz`.
The version is the 12-character commit SHA; every later stage uses HEAD's unless `REPOHIVE_VERSION` names another.
**If it fails:** `gh run view <id> --log-failed`. A failure in "Test the bundle against the image" is a real defect: the
bundle would not have worked on the box. "Not authorized to perform sts:AssumeRoleWithWebIdentity" means the bootstrap
was not applied, or the environment name and the role's trusted subject differ.

`deploy/scripts/build-in-github.sh --verify-only` runs the same build and test with no account.

## 8. The main apply, DNS and the first alarms

**8.1 Apply.**

```
REPOHIVE_ACCOUNT=<name> deploy/scripts/deploy.sh infra --plan-only     # digest read from ECR for the version
REPOHIVE_ACCOUNT=<name> deploy/scripts/deploy.sh infra --apply-saved   # after the owner has read it and said go
```

**Success:** the apply prints outputs, including `dns_records`, `cloudfront_domain_name` and `box_elastic_ip`. The first plan
lists every resource. **Note:** the AWS provider validates the state machine definition with an API call during the plan, so
a JSONata fault shows up in the plan, before anything is created.
**If it fails**, the likely first-apply faults:

- the certificate is not `ISSUED` yet (Section 5);
- the state machine definition is rejected (the JSONata forms `Items`, `Arguments`, `Assign`, the `Error` and `Cause`
  expressions on `Fail`, `$states.errorOutput` in a `Catch`, `TaskDefinition` as a bare family name were checked only
  offline, with the `jsonata` package);
- `lambda_memory_mb = 3008` refused (Section 3);
- the CloudFront arguments, or the metric-math alarm (`jobs_failed_system`);
- an AWS Budgets resource refused on the Free plan: remove `aws_budgets_budget.monthly` and tell the owner.

Fix the code, commit, push, rebuild if a package changed, plan again. A failed apply leaves a partial state; plan again, never
`import` by hand.

**8.2 Owner: DNS.** In Netlify DNS add the two records from
`REPOHIVE_ACCOUNT=<name> deploy/scripts/tf-output.sh main dns_records`:

| Name | Type | Value |
|------|------|-------|
| the site domain | CNAME | the distribution's domain name (`...cloudfront.net`) |
| `origin.<site domain>` | A | the box's Elastic IP |

**Success:** `dig +short <site domain>` returns CloudFront addresses; `dig +short origin.<site domain>` the Elastic IP.

**8.3 Owner: the SNS email.** AWS emails `ALERT_EMAIL` a confirmation link for the alarm topic; click it, or no alarm reaches
you (the site works either way; the budget emails do not use SNS). The heartbeat alarm fires after the first apply because the
site does not answer yet; it clears after Section 9.

**8.4 Caddy's origin certificate.** Caddy gets it by HTTP-01 once the A record resolves and retries until then. After
Section 9: `aws ssm start-session --target <box_instance_id>`, then `sudo journalctl -u caddy --since "10 min ago" | tail -n 40`.
**Success:** a line saying the certificate was obtained for `origin.<site domain>`.

## 9. The app release and the smoke test

The bundle was uploaded by the build (Section 7) and tested there. Activate it:

```
REPOHIVE_ACCOUNT=<name> deploy/scripts/deploy.sh app
```

**Success:** the activation output ends `activate: <version> is live`. The box checks the server's
`http://127.0.0.1:8080/healthz` for 60 s and switches back to the previous release if it never reports `ok`. The server
needs a while to start on a `t4g.small` (the JVM, Flyway, the first SQLite open); the unit allows 180 s.
**If it fails:** read the activation output, then on the box `sudo journalctl -u repohive-server -n 80` and
`/var/log/repohive/server.log`. A server that stops at start-up names the setting it refused (a `ConfigError` names the
variable, never the value); `/run/repohive/server.env` holds what `repohive-env` rendered (root only).

**Smoke test:**

```
REPOHIVE_ACCOUNT=<name> deploy/scripts/smoke.sh                            # before any index: snapshot checks skipped
REPOHIVE_ACCOUNT=<name> deploy/scripts/smoke.sh github.com/<owner>/<repo>  # after Section 10: the full set
```

**Success:** `smoke test passed`. It checks `/healthz`, that the workers' `/api/internal/**` door refuses a call without the
secret, that a `PUT` to `/api/admin/limits` reaches the server (and is refused), the viewer's pages, that snapshot objects come
from the bucket (brotli, immutable) and a missing key is 404, that `private/` and `backup/` are not served, and that the origin
refuses a direct request. A `/healthz` failure through CloudFront with the box healthy means DNS, the origin secret
header or Caddy's certificate (Section 8).

## 10. First indexes

Sign up and sign in at `https://<site domain>`, then request each index and watch it through progress to the viewer:

1. **A small public Java repository** (S tier): the Lambda path, the server's ledger, the state machine and the viewer. A
   failure `snapshot id does not match this build` means the release (whose pre-check computes the snapshot id) and the
   indexer image came from different commits: the build makes both from one commit and checks them, so redeploy both from
   one build.
2. **`BroadleafCommerce/BroadleafCommerce`** (M tier): a realistic size on Lambda.
3. **One L or XL repository**: the Fargate path, the large-job slot (the server's) and the retier.

```
aws --profile repohive --region ap-south-1 stepfunctions list-executions --state-machine-arn <arn> --max-results 5
aws --profile repohive --region ap-south-1 logs tail /aws/lambda/repohive-indexer --since 15m
aws --profile repohive --region ap-south-1 logs tail /repohive/fargate/indexer --since 15m
```

**Success:** the execution ends `SUCCEEDED`, the site shows the viewer, and the full smoke test passes. **If it fails:** the
job's own answer is the server's: `GET /api/jobs/<job id>` (the job page shows it) carries the failure class and code. An
execution `FAILED` carries the run's own error (`Lambda.*`, `States.TaskFailed`, `States.Timeout`, `ECS.*`) and says which
path failed; the server's reconciliation closes and refunds a job whose run ended without reporting (codes
`runtime-error`, `runtime-timeout`, `runtime-not-started`, `ORCHESTRATOR_START_FAILED`, `slot-wait-timeout`). A job that
reports its own failure from Fargate exits with code 1, so its execution also shows `FAILED`.

## 11. Operating

**Logs and metrics.** Log groups (14 days by default): `/aws/lambda/repohive-indexer`, `/repohive/fargate/indexer`,
`/aws/vendedlogs/states/repohive-index`, `/repohive/box/server`, `/repohive/box/caddy` (visitor IPs),
`/repohive/box/heartbeat`. Metrics: namespace `RepoHIVE/Hosted`; the server writes its own (`JobsAccepted`, `InFlight`,
`SignUps`, ...) as embedded-metric lines to its log, the workers theirs.

**A shell on the box** (no SSH): `aws ssm start-session --target <box_instance_id>`.

**Deploy a new version:** commit, push, then `deploy.sh build`, `deploy.sh infra --plan-only` / `--apply-saved` (only needed
when the indexer image or the Terraform changed; the plan says so), `deploy.sh app`.

**Roll back the app:** `REPOHIVE_ACCOUNT=<name> deploy/scripts/rollback-app.sh`. It switches to the newest other release;
rolling back twice returns to the release you left.

**Restore SQLite from `backup/`:** the server backs the database up once a day to `s3://<artifact bucket>/backup/app-<day>.sqlite`
(the newest 7 are kept). In a Session Manager shell: `sudo systemctl stop repohive-server`, copy the chosen object over
`/var/lib/repohive/data/app.sqlite` (and remove `app.sqlite-wal` and `app.sqlite-shm` beside it), `sudo chown repohive:repohive`
the file, `sudo systemctl start repohive-server`. The server migrates an older file forward on start (Flyway).

**Roll a repository back to an earlier snapshot.** Snapshots are immutable and the server alone says which one is served: the
row of `indexed_repositories` (primary key `repo`, for example `github.com/owner/repo`). `private/<owner>/<repo>/history.json`
in the bucket lists the snapshot ids still there, newest first. On the box: `sudo dnf install -y sqlite` once, then
`sudo -u repohive sqlite3 /var/lib/repohive/data/app.sqlite "UPDATE indexed_repositories SET snapshot_id = '<id>' WHERE repo = 'github.com/<owner>/<repo>'"`
(stop nothing: SQLite takes the write; the server picks it up on the next read). The row's `commit_sha`, `node_count` and
`edge_count` stay those of the newer snapshot until the next index, so use this to get a repository viewable again, not to
keep it that way.

**Rotate the origin secret:** `REPOHIVE_ACCOUNT=<name> deploy/scripts/deploy.sh infra --plan-only
-replace=random_password.origin_secret`, apply it, then `deploy.sh app` so Caddy reads the new value. Expect brief 403s while
CloudFront rolls the header out.

**Rotate the internal secret** (the workers' bearer secret): the same with `-replace=random_password.internal_secret`, apply, then
`deploy.sh app` so the server reads it. The Lambda and Fargate workers read it from SSM once when a run starts (a warm
Lambda container keeps the old one until it is recycled), so rotate while no index is running; a run in flight cannot report
and the server closes it from its execution's status.

**Replace the box without losing the data volume:** the volume has `prevent_destroy`. In a protected account, first apply
once with termination protection off (`deploy.sh infra --plan-only -var=protect=false`), then
`deploy.sh infra --plan-only -replace=aws_instance.box`, then a normal apply to turn protection back on. Re-run Section 9. Caddy's certificate lives on the data volume and survives.

## 12. Post-ship measurement

Nothing hosted was measured before ship. Record each result in `context/registers/measurements.md` with the date and
**whether it was cold or warm** (they differ by roughly eight times on this codebase). The checklist is `registers/hosting.md` § 5:

- **Item 3, Graviton2 per-core speed:** read `StageMs` and `EndToEndMs` from `RepoHIVE/Hosted` for a Lambda job.
- **Item 6, Fargate startup:** `aws ecs describe-tasks` gives `createdAt`, `pullStartedAt`, `pullStoppedAt`, `startedAt`.
- **Item 8, memory on the t4g.small:** `systemctl status repohive-server` (it shows the cgroup's memory, the JVM and the pre-check child together) and `ps -o rss` for the JVM during a large index and while several people use the viewer.
- **Item 9, quotas:** Section 3.
- **Item 10, Linux arm64 output matches the reference digests:** index `fixtures/sample-java-project` hosted and compare the
  logical digest with `registers/measurements.md`.
- **Item 11, cold against warm:** the same repository twice, the second within minutes; label them.
- **The Elasticsearch XL run inside 15 minutes** (`hosting-verifies-on-broadleaf-then-ships`): request `elastic/elasticsearch`
  and record cold and warm. If it exceeds 15 minutes, say so.
- **Embedded metrics from the box:** `aws cloudwatch list-metrics --namespace RepoHIVE/Hosted --metric-name SiteUp` must list
  it a few minutes after Section 9. If not, the heartbeat must call `put-metric-data` instead (a code change).

## 13. Re-reading the prices

The prices in `registers/hosting.md` § 2 were read for us-east-1. Re-read them for **ap-south-1** and update
§§ 2 and 4 with values and date; compare the estimate with the budget (default $25) and the account's credits.

## 14. Teardown

**A test account (`PROTECT=false`):**

```
REPOHIVE_ACCOUNT=<name> deploy/scripts/teardown.sh --confirm <account id>
```

It deletes everything RepoHIVE created there, data included: the main root (after one apply with protection off), the data
volume (outside Terraform, since it keeps `prevent_destroy`; it holds the SQLite file with every account and job), the GitHub
token and admin token parameters, the bootstrap root, the versioned state bucket (every version), and the account's GitHub
environment. It refuses an account whose `deploy.env` says
`PROTECT=true`, and skips a root whose state is empty, so it can be run again after a failure.
**Owner afterwards:** remove the Netlify records of that site domain (the site CNAME, the origin A record and the certificate
validation CNAMEs) before the Elastic IP is reused by anyone, and delete the root access key.

**A production account:** back up the SQLite file from `backup/` and snapshot the data volume, set `PROTECT=false` in its
`deploy.env`, then the same command. Closing an account is a separate step in the console.

## 15. Known risks

- **Root access keys** (owner's choice): they cannot be limited. Keep MFA on root and delete the key after use.
- **The origin secret and the internal secret are in the Terraform state.** The state bucket is private, encrypted and
  versioned. Rotation: Section 11. The admin token is not: it is stored by `put-admin-token.sh` and held only by the owner.
- **Caddy exempts `/api/internal/**` from its POST rate limit** (the workers' progress and outcome calls, from Lambda and
  Fargate addresses many jobs share, would otherwise be refused and strand a finished job); they stay under the overall
  limit and behind the bearer secret.
- **One box, one JVM.** The server, its pre-check child and Caddy share 2 GB on the `t4g.small`; `server_memory_max_mb`
  (1280) and `server_heap_mb` (512) are unmeasured defaults. A heap exhausted at run time exits the server (systemd restarts it).
- **Alarm `repohive-index-executions-failed`** also counts a Fargate job that reported its own failure (exit code 1); raise
  its threshold if a benchmark run makes it noisy.
- **Caddy access logs hold visitor IP addresses**, kept for the retention period (14 days by default).
- **The account id appears in GitHub only as an environment variable**, masked in the public build logs.
- **The unverified assumptions of the spec** (`requirements.md`, "Assumptions"): the managed prefix list counts as 55 rules of
  60; Step Functions error names for throttling; AWS Budgets on the Free plan; custom metrics beyond the 10 free ones.
- **The Free plan closes the account after six months** unless moved to the Paid plan (Section 2).
- **Windows-only provider locks** (Section 1) and **Terraform's BUSL licence** (a tool you run; nothing is linked or shipped).
- **Accounts are unverified in v1**: per-IP caps and Caddy's rate limits back the quota.
- **Fargate vCPU 8** means one L or XL run at a time.
- **The job cannot cancel the engine**: past its time limit it reports failed while the run finishes in the background.

## 16. Default alarm thresholds

All thresholds are Terraform variables (`alarm_thresholds`, `monthly_budget_usd`, in `main.tfvars`); counts are totals over
one 5-minute period.

| Alarm | Fires when | Default |
|-------|-----------|---------|
| `repohive-index-executions-failed` | state machine executions failed | 1 or more |
| `repohive-index-executions-timed-out` | executions timed out | 1 or more |
| `repohive-indexer-errors` | indexer function errors | 3 or more |
| `repohive-indexer-throttles` | indexer function throttles | 1 or more |
| `repohive-box-system-check` | `StatusCheckFailed_System` for 2 minutes; also recovers the instance | above 0 |
| `repohive-jobs-failed-system` | `JobsFailed` with `Class = system`, summed over tiers and runtimes | 3 or more |
| `repohive-site-heartbeat` | `SiteUp` below 1 for 5 minutes in a row; missing data counts as bad | 5 minutes |
| Budget `repohive-monthly` | 80% of actual and 100% of forecast spend | $25 |

## 17. What has and has not been run

**Re-verified for the Spring Boot server on 2026-10-06** (Windows 11, no AWS account; Terraform 1.16.2, Node 24.21.0, JDK 23.0.2, Caddy 2.11.6
standard build; every check below is warm):

- `terraform fmt`, `validate` and the offline `terraform test` plan of the main root (protected and unprotected) passed on a
  tree, and `deploy/scripts/check.sh` as a whole passed on it (0 failed, `shellcheck` not run); the plan renders every policy, the state
  machine and cloud-init and asserts the intended architecture: no DynamoDB grant, the job role writes only under `artifacts/`
  and `private/`, the box role only under `backup/`, `/artifacts/*` is the only behaviour that reaches the bucket and `/api/*`
  is uncached with every method, user data under 16 KB.
- The state machine's 20 JSONata expressions parse (the `jsonata` package, not Step Functions), the tier routing gives the right
  answer for S, M, L, XL and an unknown tier, and the `Fail` state's error and cause expressions evaluate; the structure test
  (`packages/indexer/src/state-machine.test.ts`) passes.
- `deploy/box/spa.caddy` and the whole Caddyfile (without the two plugin directives, which a standard Caddy lacks) ran under
  Caddy 2.11.6: `deploy/scripts/check-spa-mapping.mjs` served 28 requests against `packages/web/out` as the host mapping says (and refused 3 path-traversal attempts), and
  a stub server behind the real routes showed the secret check, the pass-through of `PUT`, `OPTIONS`, `Authorization` and the
  client-address header, a 404 for `/artifacts/*` and the 64 KiB body cap.
- `repohive-env` ran against a fake `aws`: the server and Caddy environment files it renders, the admin token left out until the
  parameter exists, and an access error not mistaken for an unset token.
- The server jar (`repohive-server/target`), run in local mode on JDK 23, answered `/healthz`, served the viewer's pages and had its pre-check child
  (Node on `packages/indexer`) answer a request.
- `bash -n` on every script. **Not run:** `shellcheck`, `actionlint` (not installed here).

**Run in GitHub Actions on 2026-10-06** (tag `verify-2835bf48a750`, linux/arm64, Java 21, no AWS; run 37494100864, 4 min 14 s):
the server's tests (186 of 186), the indexer image and the release bundle built, `verify-app-tree.sh` on the real tree, and
`verify-release.sh` (the snapshot inputs of the bundle and the image are equal, the server starts on the bundle's own Java, the
page mapping answers every request, and the bundle's Caddy adapts and validates the Caddyfile with both plugin modules).

**Never run:** any plan or apply against AWS, the build workflow's publish path (it needs the bootstrap's role), any deploy script
against an account, the box's first boot, the server unit under systemd (memory limits, `/tmp` for the SQLite native library, the
JVM next to a Node child on 2 GB), the behaviour of the Caddy plugins' directives (`rate_limit` with `not path`, `trusted_proxies
cloudfront`; they only adapt and validate), the CloudWatch agent, CloudFront, the workers reaching the server through CloudFront,
and `teardown.sh`. The first apply is the first test of all of it.

**Run for the previous stack** (no longer this stack): the indexer image built and ran jobs through its
Lambda and Fargate entry points; the release build assembled on an older bundle layout; `check.sh` passed on the old roots.
