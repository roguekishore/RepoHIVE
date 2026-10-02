#!/usr/bin/env bash
# Uploads a built release bundle and its SHA-256 to s3://<ops bucket>/releases/ (hosting-4 Requirement 15.2), without
# activating it. The build workflow runs it with its OIDC role; deploy-app.sh runs it before an activation when the
# bundle was built on this machine. Stops unless the credentials are for the configured account.
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/upload-app-release.sh [version]
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

version="${1:-$(image_tag)}"
[[ "${version}" =~ ^[A-Za-z0-9._-]+$ ]] || die "usage: upload-app-release.sh [version]"

load_deploy_env
account_guard

bundle="${DEPLOY_DIR}/out/repohive-${version}.tar.gz"
[[ -f "${bundle}" && -f "${bundle}.sha256" ]] || die "${bundle} or its .sha256 is missing; run build-app-release.sh first"
checksum="$(cut -d' ' -f1 "${bundle}.sha256")"
[[ "${checksum}" =~ ^[0-9a-f]{64}$ ]] || die "${bundle}.sha256 does not hold a SHA-256"
[[ "$(sha256sum "${bundle}" | cut -d' ' -f1)" == "${checksum}" ]] || die "${bundle} does not match its .sha256"

aws_cli s3 cp --only-show-errors "${bundle}" "s3://${OPS_BUCKET}/releases/repohive-${version}.tar.gz"
aws_cli s3 cp --only-show-errors "${bundle}.sha256" "s3://${OPS_BUCKET}/releases/repohive-${version}.tar.gz.sha256"
printf 'uploaded: s3://%s/releases/repohive-%s.tar.gz (sha256 %s)\n' "${OPS_BUCKET}" "${version}" "${checksum}"
