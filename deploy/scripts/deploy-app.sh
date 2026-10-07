#!/usr/bin/env bash
# Activates a release on the box through SSM Run Command, printing the activation output.
# If deploy/out/ holds the bundle (built on this machine), it is uploaded first; otherwise the bundle must already be
# in s3://<ops bucket>/releases/ (the build workflow puts it there) and its checksum is read from beside it. Stops
# unless the credentials are for the configured account.
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/deploy-app.sh [version]
#
# version defaults to the short git SHA of HEAD, which is what both builds name it.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

version="${1:-$(image_tag)}"
[[ "${version}" =~ ^[A-Za-z0-9._-]+$ ]] || die "usage: deploy-app.sh [version] (a short git SHA)"

load_deploy_env
account_guard

bundle="${DEPLOY_DIR}/out/repohive-${version}.tar.gz"
key="releases/repohive-${version}.tar.gz"
if [[ -f "${bundle}" && -f "${bundle}.sha256" ]]; then
  "${DEPLOY_DIR}/scripts/upload-app-release.sh" "${version}"
  checksum="$(cut -d' ' -f1 "${bundle}.sha256")"
else
  checksum="$(aws_cli s3 cp --only-show-errors "s3://${OPS_BUCKET}/${key}.sha256" - | cut -d' ' -f1)" ||
    die "s3://${OPS_BUCKET}/${key}.sha256 not found; run deploy.sh build (or build-app-release.sh here) first"
  printf 'using: s3://%s/%s (built elsewhere)\n' "${OPS_BUCKET}" "${key}"
fi
[[ "${checksum}" =~ ^[0-9a-f]{64}$ ]] || die "the release checksum is not a SHA-256: ${checksum}"

run_on_box "/usr/local/sbin/repohive-activate ${version} ${checksum}"
