#!/usr/bin/env bash
# Stores the admin token in SSM Parameter Store as /repohive/admin-token. The token is the only thing between the
# internet and the server's limits API (/api/admin/**, the owner's quota page); until it is stored the box leaves that
# API off and the server answers 404 for it. The server reads it at start-up, so run `deploy.sh app` afterwards.
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/put-admin-token.sh --generate    make a token, store it, show it once
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/put-admin-token.sh               prompts, input hidden
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/put-admin-token.sh <token-file   or from a file (one line)
#
# --generate prints the token on your terminal and refuses to run when the output is not a terminal, so a script or an
# agent running it never receives the token. With a given token it never appears on a command line or in output.
# Run again to rotate: it overwrites the parameter. The server wants at least 24 characters and a value that differs
# from the internal secret (/repohive/internal-secret); a generated token is 48 hex characters.
set -euo pipefail

# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PARAMETER_NAME="/repohive/admin-token"
generate=false
if [[ "${1:-}" == "--generate" ]]; then
  generate=true
  [[ -t 1 ]] || die "--generate shows the token once, on a terminal; run it yourself (output is not a terminal here)"
fi

load_deploy_env
account_guard

if [[ "${generate}" == "true" ]]; then
  command -v openssl >/dev/null 2>&1 || die "openssl is needed for --generate"
  token="$(openssl rand -hex 24)"
elif [[ -t 0 ]]; then
  printf 'Admin token (input is hidden): ' >&2
  IFS= read -r -s token
  printf '\n' >&2
else
  IFS= read -r token || true
fi

token="${token%$'\r'}"
[[ -n "${token}" ]] || die "no token was given"
[[ "${token}" != *[[:space:]]* ]] || die "the token must not contain whitespace"
((${#token} >= 24)) || die "the token must be at least 24 characters"

# The request goes through a private temporary file, so the token is not an argument of any process.
umask 077
request="$(mktemp)"
trap 'rm -f "${request}"' EXIT

# jq is a Windows program under Git Bash too: keep MSYS from rewriting the parameter name into a path.
printf '%s' "${token}" | MSYS2_ARG_CONV_EXCL='*' jq -R --arg name "${PARAMETER_NAME}" \
  '{Name: $name, Type: "SecureString", Tier: "Standard", Overwrite: true, Value: .}' >"${request}"

# Under Git Bash the AWS CLI is a Windows program, and MSYS does not convert a path inside a file:// argument.
request_uri="${request}"
if command -v cygpath >/dev/null 2>&1; then
  request_uri="$(cygpath -m "${request}")"
fi

aws_cli ssm put-parameter --cli-input-json "file://${request_uri}" --query Version --output text >/dev/null
printf 'Stored %s (SecureString, standard tier).\n' "${PARAMETER_NAME}"
if [[ "${generate}" == "true" ]]; then
  printf 'Token (shown once; keep it in your password manager): %s\n' "${token}"
fi
unset token
printf 'Next: REPOHIVE_ACCOUNT=%s deploy/scripts/deploy.sh app   (re-activates the release so the server reads it)\n' "${REPOHIVE_ACCOUNT}"
