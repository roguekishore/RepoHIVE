#!/usr/bin/env bash
# Builds the indexer image and the app release in GitHub Actions (.github/workflows/build.yml), natively on arm64, from
# the commit at HEAD, by pushing a tag; then follows the run to its end. Nothing else starts that workflow.
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/build-in-github.sh   tag build-<name>-<sha>: build, test, then push the image
#                                                               to the account's ECR and the bundle to its ops bucket
#   deploy/scripts/build-in-github.sh --verify-only             tag verify-<sha>: build and test only, no AWS
#
# HEAD must be committed and pushed. A tag that already exists is not pushed again: its run is followed instead.
# Needs git and the GitHub CLI (gh); an account build also runs github-environment.sh first. Calls no AWS API.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed"
repo="$(github_repository)"
sha="$(image_tag)"

if [[ "${1:-}" == "--verify-only" ]]; then
  tag="verify-${sha}"
else
  [[ -z "${1:-}" ]] || die "usage: build-in-github.sh [--verify-only]"
  load_deploy_env
  "${DEPLOY_DIR}/scripts/github-environment.sh"
  tag="build-${REPOHIVE_ACCOUNT}-${sha}"
fi

if [[ -n "$(git -C "${REPO_ROOT}" status --porcelain -- packages deploy .github)" ]]; then
  die "uncommitted changes under packages/, deploy/ or .github/; the build would not match them"
fi
git -C "${REPO_ROOT}" fetch --quiet origin
[[ -n "$(git -C "${REPO_ROOT}" branch -r --contains HEAD)" ]] ||
  die "HEAD ($(git -C "${REPO_ROOT}" rev-parse --short HEAD)) is not on origin; push the branch first"

if [[ -n "$(git -C "${REPO_ROOT}" ls-remote --tags origin "refs/tags/${tag}")" ]]; then
  printf 'tag %s already exists; following its run\n' "${tag}"
else
  git -C "${REPO_ROOT}" tag -f "${tag}" HEAD >/dev/null
  git -C "${REPO_ROOT}" push --quiet origin "refs/tags/${tag}"
  printf 'pushed tag %s\n' "${tag}"
fi

run_id=""
for _ in $(seq 1 30); do
  # Not --workflow build.yml: gh resolves that name on the default branch, where the workflow does not exist.
  run_id="$(gh run list --repo "${repo}" --branch "${tag}" --event push --limit 5 \
    --json databaseId,workflowName --jq '[.[] | select(.workflowName == "build")][0].databaseId // empty')"
  [[ -n "${run_id}" ]] && break
  sleep 5
done
[[ -n "${run_id}" ]] ||
  die "no run of build.yml appeared for ${tag}; GitHub can drop the event of a tag pushed right after a large branch push: delete the tag (git push origin :refs/tags/${tag}; git tag -d ${tag}) and run this again"

printf 'following run %s: https://github.com/%s/actions/runs/%s\n' "${run_id}" "${repo}" "${run_id}"
gh run watch "${run_id}" --repo "${repo}" --interval 30 --exit-status >/dev/null ||
  die "the build run failed: gh run view ${run_id} --repo ${repo} --log-failed"
printf 'build %s: ok (version %s)\n' "${tag}" "${sha}"
