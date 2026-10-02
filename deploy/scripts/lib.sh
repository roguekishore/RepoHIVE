#!/usr/bin/env bash
# Shared code for the deploy scripts: pick the account folder, load its deploy.env and run the account guard
# (hosting-4 Requirements 18.1 to 18.3). Source it; do not run it.
#
#   . "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
#   load_deploy_env
#   account_guard        # only in a script that calls AWS
#
# Rules every script keeps: no secret on a command line, in a log, or in an error message; every aws call
# passes --region explicitly (use aws_cli, which does).

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${DEPLOY_DIR}/.." && pwd)"
export DEPLOY_DIR REPO_ROOT

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

# Credentials: the AWS CLI profile `repohive` unless the caller chose a profile or put keys in the environment
# (GitHub Actions does, through its OIDC role). Terraform and the AWS CLI both read AWS_PROFILE.
if [[ -z "${AWS_PROFILE:-}" && -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  export AWS_PROFILE=repohive
fi

# The deploy target: one folder per AWS account, deploy/accounts/<name>/ (git-ignored), chosen by REPOHIVE_ACCOUNT.
# It holds deploy.env, optional bootstrap.tfvars and main.tfvars, the bootstrap state, each root's Terraform working
# directory and the saved plans. Nothing of one account is ever read for another.
ACCOUNT_NAME_PATTERN='^[a-z][a-z0-9]{0,19}$'

select_account() {
  [[ -n "${REPOHIVE_ACCOUNT:-}" ]] ||
    die "REPOHIVE_ACCOUNT is not set; name the account folder under deploy/accounts/ (for example REPOHIVE_ACCOUNT=test)"
  [[ "${REPOHIVE_ACCOUNT}" =~ ${ACCOUNT_NAME_PATTERN} ]] ||
    die "REPOHIVE_ACCOUNT must be lower-case letters and digits, starting with a letter, at most 20 characters"
  ACCOUNT_DIR="${DEPLOY_DIR}/accounts/${REPOHIVE_ACCOUNT}"
  # The same folder seen from a Terraform root (terraform runs with -chdir), so no absolute path is ever passed to it.
  ACCOUNT_DIR_FROM_ROOT="../../accounts/${REPOHIVE_ACCOUNT}"
  export ACCOUNT_DIR ACCOUNT_DIR_FROM_ROOT
}

# Reads <account folder>/deploy.env as plain KEY=VALUE lines (never sourced, so a stray command in it cannot run).
# Required: AWS_ACCOUNT_ID, SITE_DOMAIN. Optional: AWS_REGION (always ap-south-1), OWNER_TAG and ALERT_EMAIL (the
# Terraform applies need them), PROTECT (true or false, default true), GITHUB_OIDC_PROVIDER_ARN. The three bucket
# names are derived from the account id and exported.
load_deploy_env() {
  select_account
  local file="${DEPLOY_ENV_FILE:-${ACCOUNT_DIR}/deploy.env}"
  [[ -f "${file}" ]] || die "${file} not found; copy deploy/deploy.env.example there and fill it in"
  AWS_REGION="ap-south-1"
  PROTECT="true"
  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" == *=* ]] || die "${file}: not a KEY=VALUE line: ${line}"
    key="${line%%=*}"
    value="${line#*=}"
    case "${key}" in
      AWS_ACCOUNT_ID | AWS_REGION | SITE_DOMAIN | OWNER_TAG | ALERT_EMAIL | PROTECT | GITHUB_OIDC_PROVIDER_ARN)
        printf -v "${key}" '%s' "${value}"
        ;;
      *) die "${file}: unknown setting ${key}" ;;
    esac
  done <"${file}"

  local name
  for name in AWS_ACCOUNT_ID SITE_DOMAIN; do
    [[ -n "${!name:-}" ]] || die "${name} is not set in ${file}"
  done
  [[ "${AWS_ACCOUNT_ID}" =~ ^[0-9]{12}$ ]] || die "AWS_ACCOUNT_ID must be 12 digits"
  [[ "${AWS_REGION}" == "ap-south-1" ]] || die "AWS_REGION must be ap-south-1"
  [[ "${SITE_DOMAIN}" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*repohive\.dev$ ]] ||
    die "SITE_DOMAIN must be repohive.dev or a lower-case name under it"
  [[ "${PROTECT}" == "true" || "${PROTECT}" == "false" ]] || die "PROTECT must be true or false"
  [[ -z "${GITHUB_OIDC_PROVIDER_ARN:-}" ||
    "${GITHUB_OIDC_PROVIDER_ARN}" =~ ^arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token\.actions\.githubusercontent\.com$ ]] ||
    die "GITHUB_OIDC_PROVIDER_ARN must be this account's token.actions.githubusercontent.com provider"

  ARTIFACT_BUCKET="repohive-artifacts-${AWS_ACCOUNT_ID}"
  OPS_BUCKET="repohive-ops-${AWS_ACCOUNT_ID}"
  STATE_BUCKET="repohive-tfstate-${AWS_ACCOUNT_ID}"
  export AWS_ACCOUNT_ID AWS_REGION SITE_DOMAIN PROTECT ARTIFACT_BUCKET OPS_BUCKET STATE_BUCKET
  export OWNER_TAG="${OWNER_TAG:-}" ALERT_EMAIL="${ALERT_EMAIL:-}" GITHUB_OIDC_PROVIDER_ARN="${GITHUB_OIDC_PROVIDER_ARN:-}"
  return 0
}

# Sets up one Terraform root for the loaded account: tf_dir, TF_DATA_DIR, and the arrays init_args (backend settings)
# and plan_vars (every -var from deploy.env, plus the account's optional <root>.tfvars). Paths given to terraform are
# relative to the root directory, where it runs (-chdir), so no absolute path is ever passed to it.
tf_root_setup() {
  local root="$1"
  [[ -n "${OWNER_TAG}" ]] || die "OWNER_TAG is not set in the account's deploy.env"
  command -v terraform >/dev/null 2>&1 || die "terraform is not installed"
  tf_dir="${DEPLOY_DIR}/terraform/${root}"
  mkdir -p "${ACCOUNT_DIR}/out"
  export TF_DATA_DIR="${ACCOUNT_DIR_FROM_ROOT}/.terraform-${root}"
  export TF_IN_AUTOMATION=1
  init_args=(-input=false)
  plan_vars=(
    "-var=aws_account_id=${AWS_ACCOUNT_ID}"
    "-var=owner_tag=${OWNER_TAG}"
    "-var=site_domain=${SITE_DOMAIN}"
    "-var=protect=${PROTECT}"
  )
  if [[ "${root}" == "bootstrap" ]]; then
    init_args+=("-backend-config=path=${ACCOUNT_DIR_FROM_ROOT}/bootstrap.tfstate")
    plan_vars+=(
      "-var=account_name=${REPOHIVE_ACCOUNT}"
      "-var=github_repository=$(github_repository)"
      "-var=github_oidc_provider_arn=${GITHUB_OIDC_PROVIDER_ARN}"
    )
  else
    [[ -n "${ALERT_EMAIL}" ]] || die "ALERT_EMAIL is not set in the account's deploy.env"
    init_args+=(
      "-backend-config=bucket=${STATE_BUCKET}"
      "-backend-config=key=main/terraform.tfstate"
      "-backend-config=region=${AWS_REGION}"
    )
    plan_vars+=("-var=alert_email=${ALERT_EMAIL}")
  fi
  if [[ -f "${ACCOUNT_DIR}/${root}.tfvars" ]]; then
    plan_vars+=("-var-file=${ACCOUNT_DIR_FROM_ROOT}/${root}.tfvars")
  fi
  export tf_dir
}

# owner/repo of the GitHub repository the build workflow runs in, from the origin remote (or REPOHIVE_GITHUB_REPOSITORY).
github_repository() {
  local url="${REPOHIVE_GITHUB_REPOSITORY:-$(git -C "${REPO_ROOT}" remote get-url origin)}"
  url="${url%.git}"
  url="${url#https://github.com/}"
  url="${url#git@github.com:}"
  [[ "${url}" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || die "cannot read owner/repo from the origin remote: ${url}"
  printf '%s' "${url}"
}

# Every aws call goes through here so --region is always explicit.
aws_cli() {
  aws --region "${AWS_REGION}" "$@"
}

# Stops unless the caller's account is the configured one. Run before anything else that touches AWS.
account_guard() {
  command -v aws >/dev/null 2>&1 || die "the AWS CLI (aws) is not installed"
  local actual
  actual="$(aws_cli sts get-caller-identity --query Account --output text)" ||
    die "aws sts get-caller-identity failed; check the credentials of profile ${AWS_PROFILE:-<environment keys>}"
  [[ "${actual}" == "${AWS_ACCOUNT_ID}" ]] ||
    die "the active credentials are for account ${actual}, not the configured ${AWS_ACCOUNT_ID}"
}

# Docker 25 or later with buildx (the AWS Lambda base images need 25). On an x86-64 host, prints the binfmt
# command that arm64 emulation needs instead of running it (Requirement 7.6).
require_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed"
  local version major
  version="$(docker version --format '{{.Server.Version}}' 2>/dev/null)" ||
    die "the Docker daemon is not reachable; start Docker and try again"
  major="${version%%.*}"
  [[ "${major}" =~ ^[0-9]+$ && "${major}" -ge 25 ]] || die "Docker 25 or later is required; found ${version}"
  docker buildx version >/dev/null 2>&1 || die "docker buildx is not available"
  case "$(uname -m)" in
    x86_64 | amd64)
      printf '%s\n' \
        "note: this host is x86-64. Building and running linux/arm64 images needs emulation. If a build or run" \
        "      fails with 'exec format error', register it once (not run by these scripts):" \
        "        docker run --privileged --rm tonistiigi/binfmt --install arm64" >&2
      ;;
    *) ;;
  esac
}

# The id of the running box, found by its Name tag (Terraform tags it repohive-box).
box_instance_id() {
  local id
  id="$(aws_cli ec2 describe-instances \
    --filters "Name=tag:Name,Values=repohive-box" "Name=instance-state-name,Values=running" \
    --query 'Reservations[].Instances[].InstanceId' --output text)" ||
    die "could not look up the box"
  [[ "${id}" =~ ^i-[0-9a-f]+$ ]] || die "expected exactly one running box tagged repohive-box, found: ${id:-none}"
  printf '%s' "${id}"
}

# Runs one command on the box through SSM Run Command, prints its output, and returns its exit status.
# The command must hold no secret and no comma (version, checksum and flags only).
run_on_box() {
  local command="$1" instance command_id status="" waited=0
  instance="$(box_instance_id)"
  command_id="$(aws_cli ssm send-command --instance-ids "${instance}" --document-name AWS-RunShellScript \
    --parameters "commands=${command}" --comment "repohive deploy" \
    --query Command.CommandId --output text)" || die "ssm send-command failed"
  printf 'running on %s (command %s)\n' "${instance}" "${command_id}"
  while ((waited < 600)); do
    status="$(aws_cli ssm get-command-invocation --command-id "${command_id}" --instance-id "${instance}" \
      --query Status --output text 2>/dev/null || true)"
    case "${status}" in
      Success | Failed | Cancelled | TimedOut | Cancelling) break ;;
      *) sleep 5 && waited=$((waited + 5)) ;;
    esac
  done
  aws_cli ssm get-command-invocation --command-id "${command_id}" --instance-id "${instance}" \
    --query StandardOutputContent --output text || true
  aws_cli ssm get-command-invocation --command-id "${command_id}" --instance-id "${instance}" \
    --query StandardErrorContent --output text >&2 || true
  [[ "${status}" == "Success" ]] || die "the command on the box ended with status ${status:-unknown}"
}

# The short git SHA of HEAD, the image tag and release version (Requirement 7.2). A fixed length, so a shallow
# checkout (the build workflow's) and a full clone name the same commit the same way.
image_tag() {
  git -C "${REPO_ROOT}" rev-parse --short=12 HEAD
}

LOCAL_IMAGE_NAME="repohive-indexer"
export LOCAL_IMAGE_NAME
