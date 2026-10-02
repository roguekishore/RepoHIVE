# RepoHIVE deploy runbook

How the owner deploys, verifies, operates and tears down the hosted stack in ap-south-1. Nothing in this tree has
been run against AWS. Every command below is written, not tested: the first apply is the first real test, and
Section 17 lists what was never exercised. Where a step fails, stop and read the message before retrying; do not
re-run an apply to "see if it works".

Every step gives **Command**, **Success** and **If it fails**. Scripts live in `deploy/scripts/` and read
`deploy/deploy.env`; each one that calls AWS stops unless `aws sts get-caller-identity` matches the account id in
that file.

## Contents

1. Prerequisites
2. The account
3. Quotas
4. The domain
5. Bootstrap, then the backend file, then the certificate
6. The GitHub token
7. The image
8. The main apply, DNS and the first alarms
9. The app release and the smoke test
10. First indexes
11. Operating
12. Post-ship measurement
13. Re-reading the prices
14. Teardown
15. Known risks
16. Default alarm thresholds
17. What was never run

## 1. Prerequisites

- Terraform 1.11 or later (developed on 1.16.2), AWS CLI v2, Docker 25 or later with buildx and arm64 emulation,
  `shellcheck`, `jq`, `curl`, `git`.
- **On Windows, run everything from WSL 2.** The scripts are bash and the box files are LF. Clone the repository
  inside the WSL file system, not under `/mnt/c`.
- **The provider lock files cover `windows_amd64` only** (owner ruling, 2026-10-02). From WSL or Linux, add your
  platform once per root before `init`:

  ```
  terraform -chdir=deploy/terraform/bootstrap providers lock -platform=linux_amd64
  terraform -chdir=deploy/terraform/main providers lock -platform=linux_amd64
  ```

  Use `linux_arm64` on an arm64 machine. Do not commit the changed lock files unless you mean to.
- On an x86-64 host, register arm64 emulation once (the scripts print this and do not run it):
  `docker run --privileged --rm tonistiigi/binfmt --install arm64`.

**Command:** `terraform version && aws --version && docker buildx version && shellcheck --version && jq --version`
**Success:** every tool prints a version; Docker is 25 or later.
**If it fails:** install the missing tool. `deploy/scripts/check.sh` reports a missing `terraform` or `shellcheck` as
"not run" instead of passing.

Then run the offline checks once: `deploy/scripts/check.sh`. **Success:** `0 failed`, and nothing "not run" except what
you know is missing.

## 2. The account

1. Create the **fresh ap-south-1 account on the Free plan** (`hosting-runs-in-a-fresh-ap-south-1-account`). Turn on
   root MFA, then stop using root.
2. In IAM Identity Center create an administrator user and an administrator permission set; set up an AWS CLI profile
   for it (`aws configure sso`), the **owner profile**. Every later command runs with `AWS_PROFILE=<owner profile>`.
3. **Activate the cost allocation tags** in Billing and Cost Management: `Project`, `Environment`, `ManagedBy`, `Owner`,
   `CostCenter` (the default tags of Requirement 3.2). They appear in the console only after a resource carries them,
   so do this after the bootstrap apply.
4. **Write down the date six months after the account was created.** The Free plan closes the account then unless it
   is moved to the Paid plan, and data is deleted 90 days after closure. Move to the Paid plan before that date.
5. Copy `deploy/deploy.env.example` to `deploy/deploy.env` and fill it in (account id, `ap-south-1`, site domain,
   the three bucket names, which are `repohive-artifacts-<id>`, `repohive-ops-<id>`, `repohive-tfstate-<id>`).

**Command:** `AWS_PROFILE=<owner profile> aws sts get-caller-identity --query Account --output text`
**Success:** prints the account id in `deploy.env`.
**If it fails:** `aws sso login --profile <owner profile>`; if the id differs, you are in the wrong account: stop.

## 3. Quotas

The global in-flight cap (default 5) plus the control function must fit under Lambda's concurrency limit, a 3,008 MB
function must be allowed, and Fargate needs 8 vCPU for one L or XL run at a time (`registers/hosting.md` § 5 item 9).

```
aws --region ap-south-1 lambda get-account-settings
aws --region ap-south-1 service-quotas get-service-quota --service-code lambda --quota-code L-B99A9384
aws --region ap-south-1 service-quotas get-service-quota --service-code fargate --quota-code L-3032A538
```

**Success:** Lambda concurrent executions of at least 6 (the control function takes a slot too; more is better); Fargate
On-Demand vCPU of at least 8.
**If it fails or is short:**

- A quota code was not found: list them with `aws service-quotas list-service-quotas --service-code lambda` (or
  `fargate`) and read the names. The codes above are from memory and unchecked.
- Concurrency below 6: lower the global in-flight cap (the ledger's cap, default 5), or ask for an increase
  (`aws service-quotas request-service-quota-increase`). A fresh account's limit can be low enough that AWS refuses reserved
  concurrency, which is why the function has none.
- The 3,008 MB memory setting is refused at the first apply: set `lambda_memory_mb` lower in `prod.tfvars` (for example
  2048), apply, and record the quota. The heap default of 2,400 MB then no longer fits: lower `NODE_OPTIONS` in the
  image or the function before indexing M repositories.
- Fargate vCPU below 8: set `fargate_cpu_units = 4096` and `fargate_memory_mb = 8192` (valid together) and expect L and
  XL runs to be slower, or request an increase.

## 4. The domain

Choose the **site domain**: `repohive.dev` or a name under it, for example `app.repohive.dev`. The origin domain is
`origin.<site domain>`. DNS stays in Netlify DNS and every record is added by hand.

**Checks:**

1. In Netlify, confirm no site currently serves the chosen name (a Netlify site on the name would keep answering).
2. Read any CAA records on `repohive.dev`: `dig CAA repohive.dev +short`. **Success:** none, or records that allow
   both `amazon.com` (CloudFront's certificate) and `letsencrypt.org` (Caddy's origin certificate).
   **If it fails:** add `0 issue "amazon.com"` and `0 issue "letsencrypt.org"` in Netlify DNS.

## 5. Bootstrap, the backend file, the certificate

**5.1 Bootstrap apply** (state bucket, ops bucket, ECR repository, CloudFront certificate; local state).

```
cp deploy/terraform/bootstrap/prod.tfvars.example deploy/terraform/bootstrap/prod.tfvars   # then edit it
AWS_PROFILE=<owner profile> deploy/scripts/apply.sh bootstrap
```

Read the plan, then type `apply`. **Success:** the apply ends with outputs. **Keep `deploy/terraform/bootstrap/terraform.tfstate`
safe**: it is local state and the only record of these resources (it is git-ignored). Copy it somewhere private.
**If it fails:** an `allowed_account_ids` error means the profile or `aws_account_id` is wrong. A bucket-name clash means
the name is taken: it is derived from the account id, so check that id.

**5.2 The backend file for the main root.**

```
terraform -chdir=deploy/terraform/bootstrap output state_bucket
cp deploy/terraform/main/backend.hcl.example deploy/terraform/main/backend.hcl   # put the bucket name in it
cp deploy/terraform/main/prod.tfvars.example deploy/terraform/main/prod.tfvars   # then edit it
```

**Success:** `backend.hcl` names `repohive-tfstate-<account id>`; `prod.tfvars` has real values. Leave
`indexer_image_digest` as the placeholder until Section 7.

**5.3 Certificate validation records.**

```
terraform -chdir=deploy/terraform/bootstrap output certificate_validation_records
```

Add each record (a CNAME) in Netlify DNS. Then wait, checking every few minutes:

```
aws --region us-east-1 acm describe-certificate --certificate-arn <certificate_arn> --query Certificate.Status --output text
```

**Success:** `ISSUED`. **If it stays `PENDING_VALIDATION`:** `dig CNAME <record name> +short` must return the value;
Netlify adds the zone name automatically, so enter the name without the `repohive.dev` suffix if it shows doubled.
The main apply fails clearly until this is `ISSUED`.

## 6. The GitHub token

Create a **fine-grained personal access token** on GitHub: resource owner = your account, **public repositories read-only,
no other permission**, the longest expiry you accept. Note the expiry date; when it passes, every index request fails
until the token is replaced (the alarm for failed jobs and the logs will show it).

**Store it:**

```
AWS_PROFILE=<owner profile> deploy/scripts/put-github-token.sh
```

The script reads the token from standard input without echoing it. **Success:** it reports the parameter
`/repohive/github-token`. **If it fails:** it needs `jq`; check the account guard message.

**Rotate it:** create the new token, run the same script (it overwrites the parameter), then restart the box's units
so they re-read it: `AWS_PROFILE=<owner profile> deploy/scripts/deploy-app.sh <current version>` or, without a new
release, a Session Manager shell and `sudo systemctl restart repohive-env repohive-web repohive-worker`. The Lambda
function reads it once per cold start and the Fargate task at start, so new runs pick it up; revoke the old token on
GitHub afterwards.

## 7. The image

**The indexer image has never been built.** `packages/indexer/DEPLOY.md` and the Dockerfile were written without a
running Docker. The first thing to check is the `npm ci --workspace @repohive/indexer --include-workspace-root` stage
of `packages/indexer/Dockerfile`: a lockfile that names every workspace may reject the partial install. Suspected
problems, none confirmed: neither base image is pinned by digest, and the production stage's `npm ci --omit=dev` and
copy loop fail only at the last step if a package has no `dist/`. If the build fails, fix the Dockerfile (that is a
code change, not a deploy step) and rebuild.

**7.1 Build.**

```
deploy/scripts/build-indexer-image.sh
```

**Success:** the image `repohive-indexer:<short git sha>` exists (`docker image ls repohive-indexer`). The script refuses an
uncommitted change under `packages/`.

**7.2 The local run** (Requirement 7.5). `deploy/scripts/run-indexer-image-locally.sh` runs the image on the
`sample-java-project` tarball, no AWS. It has three modes: `cli` (the whole job, the real proof the image holds a
working job), `lambda` (the default command under the runtime interface emulator; it must answer with a job-input error)
and `fargate` (it must exit 1 naming `REPOHIVE_JOB_INPUT`). The last two prove only that each entry point loads: the
entry points always build the GitHub fetcher, so the sample job cannot run through them without calling GitHub.

**Success:** `all` ends with each mode reporting its expected result. **Record the result and the date in
`context/registers/measurements.md`.** **If it fails:** read the container's output; an `exec format error` means arm64
emulation is not registered (Section 1).

**7.3 Push.**

```
AWS_PROFILE=<owner profile> deploy/scripts/push-indexer-image.sh
```

**Success:** it prints `indexer_image_digest = "sha256:..."` and also writes it to `deploy/out/indexer-image.digest`. Put
that value in `deploy/terraform/main/prod.tfvars` (or let `deploy.sh infra` pass it). **If it fails:** an ECR login error
is usually an expired SSO session; a tag-immutability error means that tag was pushed before: build from a new commit.

## 8. The main apply, DNS and the first alarms

**8.1 Apply.**

```
AWS_PROFILE=<owner profile> deploy/scripts/apply.sh main
```

(or `deploy/scripts/deploy.sh infra`, which passes the recorded digest). Read the plan. **It lists the first creation of
every resource, so expect a long plan.** **Success:** the apply ends and prints outputs, including `dns_records`,
`cloudfront_domain_name`, `box_elastic_ip`.

**If it fails**, the likely first-apply faults, in rough order of how little they were checked:

- the certificate is not `ISSUED` yet (Section 5.3);
- the state machine definition is rejected: the JSONata forms (`Items`, `Arguments`, `Assign`, the `Error` expression
  on `Fail`, `TaskDefinition` as a bare family name, `ListTasks` with `StartedBy`) were never validated;
- `lambda_memory_mb = 3008` refused (Section 3);
- the CloudFront arguments, or the metric-math alarm (`jobs_failed_system`);
- an AWS Budgets resource refused on the Free plan (the spec assumed it is allowed): remove `aws_budgets_budget.monthly`
  and tell the owner.

Fix the code, commit, re-run. A failed apply leaves a partial state; run `plan` again, never `import` by hand.

**8.2 DNS.** In Netlify DNS add the records from `terraform -chdir=deploy/terraform/main output dns_records`:

| Name | Type | Value |
|------|------|-------|
| the site domain | CNAME | the distribution's domain name (`...cloudfront.net`) |
| `origin.<site domain>` | A | the box's Elastic IP |

Check both:

```
dig +short <site domain>
dig +short origin.<site domain>
```

**Success:** the first returns CloudFront addresses (or the `cloudfront.net` name then addresses), the second the Elastic
IP. **If it fails:** the apex of a zone cannot hold a CNAME at some providers; use a name under `repohive.dev`, as
Section 4 suggests.

**8.3 Confirm the SNS subscription.** AWS emails `alert_email` a confirmation: click it. Without it no alarm is delivered.
The heartbeat alarm fires after the first apply because the site does not answer yet; it clears after Section 9.

**8.4 Caddy's origin certificate.** Caddy fetches it by HTTP-01 on port 80 once the A record resolves; it retries until
then. After Section 9 starts Caddy, check from a Session Manager shell:

```
aws ssm start-session --target <box_instance_id>
sudo journalctl -u caddy --since "10 min ago" | tail -n 40
```

**Success:** a log line saying the certificate was obtained for `origin.<site domain>`. **If it fails:** the A record is
wrong or port 80 is blocked (the box's security group allows 80 from anywhere); Let's Encrypt rate-limits repeated failures.

## 9. The app release and the smoke test

**The release build is the first Linux check of the standalone output.** On Windows `next build` could not create the
`node_modules/@repohive/*` links (symlink `EPERM`), so the build copies those packages in as real directories and
`deploy/box/verify-app-tree.sh` fails the build if any is missing. If it fails, read which package and fix
`deploy/box/Dockerfile.release`.

**Command:**

```
AWS_PROFILE=<owner profile> deploy/scripts/deploy.sh app      # build-app-release.sh, then deploy-app.sh
```

**Success:** the activation output ends with `activate: <version> is live`. The script health-checks
`http://127.0.0.1:3000/healthz` for 60 s and switches back to the previous release if it never reports `ok`.
**If it fails:** read the activation output, then on the box `sudo journalctl -u repohive-web -u repohive-worker -n 80`
and `/var/log/repohive/web.log`. Unverified: the worker runs from TypeScript sources under Node 24's type stripping, and
the web unit reads `/run/repohive/web.env`; both were checked only by reading.

**Smoke test:**

```
deploy/scripts/smoke.sh                           # before any index exists: snapshot checks are skipped and say so
deploy/scripts/smoke.sh github.com/<owner>/<repo>  # after Section 10: the full set
```

**Success:** `smoke test passed`. **If it fails:** each failing line names the check. A `/healthz` failure through
CloudFront with the box healthy means DNS, the origin secret header or Caddy's certificate (check Section 8).

## 10. First indexes

Sign up and sign in at `https://<site domain>`, then request each index from the site and watch it through progress to
the viewer.

1. **A small public Java repository** (S tier): proves the Lambda path, the ledger, the state machine and the viewer.
2. **`BroadleafCommerce/BroadleafCommerce`** (M tier): proves a realistic size on Lambda.
3. **One L or XL repository**: proves the Fargate path, the large slot and the retier loop.

Every step is the first time that code touches AWS: the `hosting-2` AWS implementations (S3 store, DynamoDB ledger,
Lambda and Fargate entry points) and the `hosting-3` Step Functions orchestrator. Watch:

```
aws --region ap-south-1 stepfunctions list-executions --state-machine-arn <arn> --max-results 5
aws --region ap-south-1 logs tail /aws/lambda/repohive-indexer --since 15m
aws --region ap-south-1 logs tail /repohive/fargate/indexer --since 15m
```

**Success:** the execution ends `SUCCEEDED`, the site shows the viewer, and `smoke.sh github.com/<owner>/<repo>` passes in
full. **If it fails:** an execution `FAILED` with an error named after a code (`slot-wait-timeout`, `runtime-timeout`,
`runtime-error`, `runtime-not-started`, `retier-limit`) says which path failed; the job's own record in the ledger
says why. Step Functions logs only errors (no execution data): use the Console's execution history.

## 11. Operating

**Logs and metrics.** Log groups (retention 14 days by default): `/aws/lambda/repohive-indexer`, `/aws/lambda/repohive-control`,
`/repohive/fargate/indexer`, `/aws/vendedlogs/states/repohive-index`, `/repohive/box/web`, `/repohive/box/worker`,
`/repohive/box/caddy` (visitor IPs), `/repohive/box/heartbeat`. Metrics are in the namespace `RepoHIVE/Hosted`. Embedded-metric
extraction from the box files is an assumption: confirm it (Section 12).

**A shell on the box** (no SSH): `aws ssm start-session --target <box_instance_id>`.

**Roll back the app:** `AWS_PROFILE=<owner profile> deploy/scripts/rollback-app.sh`. **Success:** `rolled back to <path>`.
It switches to the newest other release; rolling back twice returns to the release you left.

**Restore SQLite from `backup/`:** follow `packages/web/README.md`, "Restore". In short: in a Session Manager shell stop
`repohive-web` and `repohive-worker`, copy the chosen object from `s3://<artifact bucket>/backup/` over
`/var/lib/repohive/data/app.sqlite` (the app's restore function keeps a `.before-restore` copy), start both units.

**Rotate the origin secret:** run `AWS_PROFILE=<owner profile> deploy/scripts/apply.sh main -replace=random_password.origin_secret`
(extra arguments go to `plan`). It updates the parameter and the CloudFront header together; then re-run the app
activation (or restart `repohive-env` and `caddy`) so Caddy reads the new value. CloudFront takes minutes to roll the header
out: expect brief 403s.

**Replace the box without losing the data volume:** the data volume has `prevent_destroy`, the instance has termination
protection. Taint the instance (`apply.sh main -replace=aws_instance.box`), after disabling termination protection by
setting `disable_api_termination = false` and applying once. The volume detaches (the instance is stopped first) and
re-attaches; the Elastic IP re-associates. Re-run Section 9 to put a release on the new box. Caddy's certificate lives on
the data volume and survives.

## 12. Post-ship measurement

Nothing hosted was measured before ship. Record each result in `context/registers/measurements.md` with the date and
**whether it was cold or warm** (they differ by roughly eight times on this codebase). The checklist is `registers/hosting.md` § 5:

- **Item 3, Graviton2 per-core speed:** run the same job on Lambda and read `StageMs` and `EndToEndMs` from the
  `RepoHIVE/Hosted` metrics; compare with the probe machine's figures.
- **Item 6, Fargate startup, with and without zstd layers (Requirement 7.4):** read the task's `createdAt`,
  `pullStartedAt`, `pullStoppedAt`, `startedAt` with `aws ecs describe-tasks`. For the zstd experiment build a second image
  with `--output type=image,compression=zstd,force-compression=true` (Lambda's support for zstd layers is unverified), push it
  under a new tag, point a copy of the task definition at it, and compare. Do not change the Lambda image.
- **Item 8, viewer memory on a t4g.small serving Elasticsearch-sized views:** on the box, `systemctl status repohive-web`
  (memory) and `ps -o rss` while loading a large view.
- **Item 9, quotas:** Section 3.
- **Item 10, Linux arm64 output matches the reference digests:** index `fixtures/sample-java-project` through the hosted path
  and compare the logical digest with `registers/measurements.md`.
- **Item 11, cold against warm on the target runtimes:** run the same repository twice, the second within minutes; label them.
- **The Elasticsearch XL run inside 15 minutes.** This is the hard requirement (`hosting-verifies-on-broadleaf-then-ships`).
  Request `elastic/elasticsearch`, read the execution's start and end times and the Fargate task's, and record cold and warm.
  If it exceeds 15 minutes, the XL tier does not meet its requirement: say so, do not average it away.
- **Embedded metrics from the box (Requirement 16.3):** after a few minutes, `aws cloudwatch list-metrics --namespace RepoHIVE/Hosted --metric-name SiteUp`
  must list the metric. If it does not, the file-based EMF assumption is wrong: the agent needs its EMF endpoint, or the
  heartbeat must call `aws cloudwatch put-metric-data` instead (a code change).

## 13. Re-reading the prices

The prices in `registers/hosting.md` § 2 were read for us-east-1 on 2026-10-01. Re-read them for **ap-south-1** (the AWS
pricing pages for Lambda, Fargate Graviton, EC2 t4g, DynamoDB on-demand, CloudFront price class 200, CloudWatch), then update
§§ 2 and 4 with the values and the date (`hosting-runs-in-a-fresh-ap-south-1-account`). Compare the monthly estimate with
the budget (default $25) and with the Free plan credits.

## 14. Teardown

`terraform destroy` on the main root removes everything except what is protected:

- **Protected, kept on purpose:** the data volume (`prevent_destroy`), the DynamoDB table (deletion protection), the state
  bucket (`prevent_destroy`). A destroy stops at them with an error; that is the design.
- **Order to remove them deliberately:** (1) back up what you need: the SQLite file from `backup/` and the data volume
  (a snapshot); (2) in the main root set `disable_api_termination = false` on the box and remove the `prevent_destroy` line
  from `aws_ebs_volume.data`, set `deletion_protection_enabled = false` on the table, apply; (3) `terraform destroy` the main
  root; (4) empty and delete the artifact bucket if Terraform could not (objects present); (5) remove `prevent_destroy` from
  the state bucket in the bootstrap root and destroy that root last, after emptying its versioned bucket (every version and
  delete marker); (6) ECR images are removed with the repository (set `force_delete` if it refuses).
- **Remove the Netlify DNS records** (the site CNAME, the origin A record, the certificate validation CNAMEs) *before*
  releasing the Elastic IP, so no name points at an address that another account can receive.
- Closing the account is a separate step in the console.

## 15. Known risks

- **The origin secret is in the Terraform state.** The state bucket is private, encrypted and versioned, but anyone who can
  read it can read the secret. Rotation: Section 11.
- **Caddy access logs hold visitor IP addresses.** They are kept only for the retention period (14 days by default).
- **The unverified assumptions of the spec** (`requirements.md`, "Assumptions"): EMF lines shipped by the agent become
  metrics; the managed prefix list counts as 55 rules of 60; Step Functions error names for throttling; Amazon Linux 2023 ships
  the AWS CLI v2 and offers the CloudWatch agent package; AWS Budgets is available on the Free plan; Lambda concurrency fits the
  in-flight cap; custom metrics exceed the 10 free ones (a few dollars a month, an estimate).
- **The Free plan closes the account after six months** unless moved to the Paid plan (Section 2).
- **Windows-only provider locks** (Section 1) and **Terraform's BUSL licence** (a tool you run, nothing linked or shipped; the
  owner should confirm it is acceptable).
- **Accounts are unverified in v1**: per-IP caps and Caddy's rate limits back the quota.
- **Fargate vCPU 8** means one L or XL run at a time.
- **The job cannot cancel the engine**: past its time limit it reports failed while the run finishes in the background.
- **Rolling back twice** returns to the release you left (Section 11).

## 16. Default alarm thresholds

All thresholds are Terraform variables (`alarm_thresholds`, `monthly_budget_usd`); counts are totals over one 5-minute period.

| Alarm | Fires when | Default |
|-------|-----------|---------|
| `repohive-index-executions-failed` | state machine executions failed | 1 or more |
| `repohive-index-executions-timed-out` | executions timed out | 1 or more |
| `repohive-indexer-errors` | indexer function errors | 3 or more |
| `repohive-indexer-throttles` | indexer function throttles | 1 or more |
| `repohive-control-errors` | control function errors | 1 or more |
| `repohive-box-system-check` | `StatusCheckFailed_System` for 2 minutes; also recovers the instance | above 0 |
| `repohive-jobs-failed-system` | `JobsFailed` with `Class = system`, summed over tiers and runtimes | 3 or more |
| `repohive-site-heartbeat` | `SiteUp` below 1 for 5 minutes in a row; missing data counts as bad | 5 minutes |
| Budget `repohive-monthly` | 80% of actual and 100% of forecast spend | $25 |

## 17. What was never run

Everything. The plan, the apply, every script except `check.sh`, the image build and its local run, the release build, the
box's first boot, Caddy, the CloudWatch agent, the state machine, CloudFront, every runbook step, real AWS and GitHub calls,
Linux and arm64. Only syntax and types were checked, on Windows. The progress file of the spec
(`context/specs/hosting-4-deploy/progress.md`) lists, phase by phase, what to expect to break at the first apply.
