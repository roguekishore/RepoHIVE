#!/usr/bin/env bash
# The one deploy command for one account (hosting-4 Requirement 18.5). Each stage runs alone.
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/deploy.sh <stage> [arguments]
#
#   build                 build-in-github.sh: build and test both artifacts in GitHub Actions on arm64, push the image
#                         to the account's ECR and the release to its ops bucket (the usual path)
#   image                 build-indexer-image.sh then push-indexer-image.sh, on this machine (a Linux arm64 host)
#   infra [mode]          apply.sh main with indexer_image_digest read from ECR for the version; mode is passed on
#                         (--plan-only, --apply-saved, or none for the interactive prompt)
#   app                   deploy-app.sh: activate the version on the box
#   smoke                 smoke.sh; set SMOKE_REPO (github.com/owner/repo) to check a known snapshot too
#   all                   build, infra (interactive), app, smoke
#
# The version is the short git SHA of HEAD unless REPOHIVE_VERSION names another; the build names both artifacts after
# it. A fresh account cannot run every stage in one go (certificate, DNS, token): see deploy/RUNBOOK.md.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

scripts="${DEPLOY_DIR}/scripts"
version="${REPOHIVE_VERSION:-$(image_tag)}"

stage_build() {
  [[ "${version}" == "$(image_tag)" ]] || die "the build always builds HEAD; unset REPOHIVE_VERSION or check out ${version}"
  "${scripts}/build-in-github.sh"
}

stage_image() {
  "${scripts}/build-indexer-image.sh"
  "${scripts}/push-indexer-image.sh"
}

stage_infra() {
  load_deploy_env
  account_guard
  local digest="${INDEXER_IMAGE_DIGEST:-}"
  if [[ -z "${digest}" ]]; then
    digest="$(aws_cli ecr describe-images --repository-name repohive/indexer --image-ids "imageTag=${version}" \
      --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || true)"
  fi
  [[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]] ||
    die "no indexer image ${version} in ECR: run 'deploy.sh build' first, or set INDEXER_IMAGE_DIGEST"
  printf 'indexer image %s: %s\n' "${version}" "${digest}"
  if [[ "${1:-}" == "--apply-saved" ]]; then
    "${scripts}/apply.sh" main --apply-saved
  else
    "${scripts}/apply.sh" main "$@" "-var=indexer_image_digest=${digest}"
  fi
}

stage_app() {
  "${scripts}/deploy-app.sh" "${version}"
}

stage_smoke() {
  if [[ -n "${SMOKE_REPO:-}" ]]; then
    "${scripts}/smoke.sh" "${SMOKE_REPO}"
  else
    "${scripts}/smoke.sh"
  fi
}

stage="${1:-}"
[[ $# -gt 0 ]] && shift
case "${stage}" in
  build) stage_build ;;
  image) stage_image ;;
  infra) stage_infra "$@" ;;
  app) stage_app ;;
  smoke) stage_smoke ;;
  all)
    stage_build
    stage_infra
    stage_app
    stage_smoke
    ;;
  *) die "usage: deploy.sh <build|image|infra [--plan-only|--apply-saved]|app|smoke|all>" ;;
esac
