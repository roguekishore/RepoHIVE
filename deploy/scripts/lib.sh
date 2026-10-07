#!/usr/bin/env bash
# Shared code for the deploy scripts: load deploy/deploy.env and run the account guard
#. Source it; do not run it.
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

# Reads deploy/deploy.env as plain KEY=VALUE lines (never sourced, so a stray command in it cannot run).
load_deploy_env() {
  local file="${DEPLOY_ENV_FILE:-${DEPLOY_DIR}/deploy.env}"
  [[ -f "${file}" ]] || die "${file} not found; copy deploy/deploy.env.example and fill it in"
  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" == *=* ]] || die "${file}: not a KEY=VALUE line: ${line}"
    key="${line%%=*}"
    value="${line#*=}"
    case "${key}" in
      AWS_ACCOUNT_ID | AWS_REGION | SITE_DOMAIN | ARTIFACT_BUCKET | OPS_BUCKET | STATE_BUCKET)
        printf -v "${key}" '%s' "${value}"
        export "${key?}"
        ;;
      *) die "${file}: unknown setting ${key}" ;;
    esac
  done <"${file}"

  local name
  for name in AWS_ACCOUNT_ID AWS_REGION SITE_DOMAIN ARTIFACT_BUCKET OPS_BUCKET STATE_BUCKET; do
    [[ -n "${!name:-}" ]] || die "${name} is not set in ${file}"
  done
  [[ "${AWS_ACCOUNT_ID}" =~ ^[0-9]{12}$ ]] || die "AWS_ACCOUNT_ID must be 12 digits"
  [[ "${AWS_REGION}" == "ap-south-1" ]] || die "AWS_REGION must be ap-south-1"
  [[ "${SITE_DOMAIN}" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*repohive\.dev$ ]] ||
    die "SITE_DOMAIN must be repohive.dev or a lower-case name under it"
  return 0
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
    die "aws sts get-caller-identity failed; check AWS_PROFILE and your session"
  [[ "${actual}" == "${AWS_ACCOUNT_ID}" ]] ||
    die "the active credentials are for account ${actual}, not the configured ${AWS_ACCOUNT_ID}"
}

# Docker 25 or later with buildx (the AWS Lambda base images need 25). On an x86-64 host, prints the binfmt
# command that arm64 emulation needs instead of running it.
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

# The short git SHA of HEAD, the image tag.
image_tag() {
  git -C "${REPO_ROOT}" rev-parse --short HEAD
}

LOCAL_IMAGE_NAME="repohive-indexer"
export LOCAL_IMAGE_NAME
