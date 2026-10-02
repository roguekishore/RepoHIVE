#!/usr/bin/env bash
# Ships a built release to the box (hosting-4 Requirement 15.2): uploads deploy/out/repohive-<version>.tar.gz to
# s3://<ops bucket>/releases/ and runs the activation script on the box through SSM Run Command, printing its
# output. Stops unless the credentials are for the configured account.
#
#   deploy/scripts/deploy-app.sh <version>
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

version="${1:-}"
[[ "${version}" =~ ^[A-Za-z0-9._-]+$ ]] || die "usage: deploy-app.sh <version> (the short git SHA build-app-release.sh printed)"

load_deploy_env
account_guard

bundle="${DEPLOY_DIR}/out/repohive-${version}.tar.gz"
[[ -f "${bundle}" && -f "${bundle}.sha256" ]] || die "${bundle} or its .sha256 is missing; run build-app-release.sh first"
checksum="$(cut -d' ' -f1 "${bundle}.sha256")"
[[ "${checksum}" =~ ^[0-9a-f]{64}$ ]] || die "${bundle}.sha256 does not hold a SHA-256"

aws_cli s3 cp --only-show-errors "${bundle}" "s3://${OPS_BUCKET}/releases/repohive-${version}.tar.gz"
printf 'uploaded: s3://%s/releases/repohive-%s.tar.gz\n' "${OPS_BUCKET}" "${version}"

run_on_box "/usr/local/sbin/repohive-activate ${version} ${checksum}"
