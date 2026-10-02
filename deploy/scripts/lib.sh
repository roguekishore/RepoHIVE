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
