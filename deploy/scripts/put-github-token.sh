#!/usr/bin/env bash
# Stores the GitHub token in SSM Parameter Store as /repohive/github-token.
# The token is read from standard input without echo and never appears on a command line or in output.
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/put-github-token.sh            # prompts, input hidden
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/put-github-token.sh <token-file   # or from a file (one line)
#
# Run again to rotate: it overwrites the parameter. Create the token as the runbook describes (a fine-grained
# personal access token with read-only access to public repositories and no other permission).
set -euo pipefail

# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PARAMETER_NAME="/repohive/github-token"

load_deploy_env
account_guard

if [[ -t 0 ]]; then
  printf 'GitHub token (input is hidden): ' >&2
  IFS= read -r -s token
  printf '\n' >&2
else
  IFS= read -r token || true
fi

token="${token%$'\r'}"
[[ -n "${token}" ]] || die "no token was given"
[[ "${token}" != *[[:space:]]* ]] || die "the token must not contain whitespace"

# The request goes through a private temporary file, so the token is not an argument of any process.
umask 077
request="$(mktemp)"
trap 'rm -f "${request}"' EXIT

printf '%s' "${token}" | jq -R --arg name "${PARAMETER_NAME}" \
  '{Name: $name, Type: "SecureString", Tier: "Standard", Overwrite: true, Value: .}' >"${request}"
unset token

aws_cli ssm put-parameter --cli-input-json "file://${request}" --query Version --output text >/dev/null
printf 'Stored %s (SecureString, standard tier).\n' "${PARAMETER_NAME}"
