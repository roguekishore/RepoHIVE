#!/usr/bin/env bash
# The one deploy command: build and push the indexer image, apply the main root with
# its digest, build and deploy the app release, then run the smoke test. Each stage runs alone.
#
#   AWS_PROFILE=<owner profile> deploy/scripts/deploy.sh [all|indexer|infra|app|smoke]
#
#   indexer   build-indexer-image.sh, then push-indexer-image.sh (records the digest in deploy/out/)
#   infra     apply.sh main, with the recorded digest (or INDEXER_IMAGE_DIGEST) as indexer_image_digest
#   app       build-app-release.sh, then deploy-app.sh
#   smoke     smoke.sh; set SMOKE_REPO (for example github.com/owner/repo) to check a known snapshot too
#
# Not every stage can run on a fresh account: see deploy/RUNBOOK.md for the first-time order.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

scripts="${DEPLOY_DIR}/scripts"
digest_file="${DEPLOY_DIR}/out/indexer-image.digest"

stage_indexer() {
  "${scripts}/build-indexer-image.sh"
  "${scripts}/push-indexer-image.sh"
}

stage_infra() {
  local digest="${INDEXER_IMAGE_DIGEST:-}"
  if [[ -z "${digest}" && -f "${digest_file}" ]]; then
    digest="$(<"${digest_file}")"
  fi
  [[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]] ||
    die "no indexer image digest: run 'deploy.sh indexer' first, or set INDEXER_IMAGE_DIGEST"
  "${scripts}/apply.sh" main "-var=indexer_image_digest=${digest}"
}

stage_app() {
  "${scripts}/build-app-release.sh"
  "${scripts}/deploy-app.sh" "$(image_tag)"
}

stage_smoke() {
  if [[ -n "${SMOKE_REPO:-}" ]]; then
    "${scripts}/smoke.sh" "${SMOKE_REPO}"
  else
    "${scripts}/smoke.sh"
  fi
}

case "${1:-all}" in
  indexer) stage_indexer ;;
  infra) stage_infra ;;
  app) stage_app ;;
  smoke) stage_smoke ;;
  all)
    stage_indexer
    stage_infra
    stage_app
    stage_smoke
    ;;
  *) die "usage: deploy.sh [all|indexer|infra|app|smoke]" ;;
esac
