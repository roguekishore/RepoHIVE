#!/usr/bin/env bash
# Creates or updates the GitHub environment of one account, which the build workflow runs in for it: the environment
# is named after the account folder, holds the variables AWS_ACCOUNT_ID and SITE_DOMAIN, and admits only tags
# build-<account>-* (so no other ref can assume the account's build role). Calls GitHub only, never AWS. Needs the
# GitHub CLI (gh) logged in as someone who administers the repository.
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/github-environment.sh
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_deploy_env
command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed"
repo="$(github_repository)"
environment="${REPOHIVE_ACCOUNT}"
pattern="build-${environment}-*"

gh api --silent -X PUT "repos/${repo}/environments/${environment}" \
  -F "deployment_branch_policy[protected_branches]=false" \
  -F "deployment_branch_policy[custom_branch_policies]=true"

existing="$(gh api "repos/${repo}/environments/${environment}/deployment-branch-policies" \
  --jq ".branch_policies[] | select(.name == \"${pattern}\" and .type == \"tag\") | .id")"
if [[ -z "${existing}" ]]; then
  gh api --silent -X POST "repos/${repo}/environments/${environment}/deployment-branch-policies" \
    -f "name=${pattern}" -f "type=tag"
fi

# Variables, not secrets: neither value is a credential. The workflow masks the account id in its logs.
gh variable set AWS_ACCOUNT_ID --repo "${repo}" --env "${environment}" --body "${AWS_ACCOUNT_ID}"
gh variable set SITE_DOMAIN --repo "${repo}" --env "${environment}" --body "${SITE_DOMAIN}"

printf 'GitHub environment %s in %s: tags %s only, AWS_ACCOUNT_ID and SITE_DOMAIN set.\n' \
  "${environment}" "${repo}" "${pattern}"
