#!/usr/bin/env bash
# Builds the app release bundle (hosting-4 Requirement 15.1) in a linux/arm64 container from
# deploy/box/Dockerfile.release and writes deploy/out/repohive-<git sha>.tar.gz and its SHA-256.
# Needs Docker 25 or later with buildx; does not call AWS. Refuses to build from a working tree with
# uncommitted changes under packages/ or deploy/box/, so the version names what was built.
#
#   deploy/scripts/build-app-release.sh
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_docker

if [[ -n "$(git -C "${REPO_ROOT}" status --porcelain -- packages deploy/box)" ]]; then
  die "uncommitted changes under packages/ or deploy/box/; commit or stash them so the version matches the build"
fi

version="$(image_tag)"
out_dir="${DEPLOY_DIR}/out"
tree="${out_dir}/tree-${version}"
bundle="${out_dir}/repohive-${version}.tar.gz"
mkdir -p "${out_dir}"
rm -rf -- "${tree}"

docker buildx build \
  --platform linux/arm64 \
  --provenance=false \
  --file "${DEPLOY_DIR}/box/Dockerfile.release" \
  --target release \
  --build-arg "GIT_SHA=${version}" \
  --output "type=local,dest=${tree}" \
  "${REPO_ROOT}"

# The Dockerfile already ran the check inside the container; run it again on what was exported, so a bundle
# that lost something in the export is caught before it is uploaded.
sh "${DEPLOY_DIR}/box/verify-app-tree.sh" "${tree}"

# The export directory is private (0700), and tar as root on the box restores the archive root's mode onto the
# release directory, which the repohive and caddy users must enter.
chmod 0755 "${tree}"

# Sorted names, fixed owner and time, no gzip timestamp: the same tree gives the same bytes.
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='2000-01-01 00:00:00 UTC' \
  -C "${tree}" -cf - . | gzip -n -9 >"${bundle}"
root_mode="$(tar -tvzf "${bundle}" | sed -n 1p | cut -c1-10)"
[[ "${root_mode}" == "drwxr-xr-x" ]] || die "the bundle's root directory is ${root_mode}, not drwxr-xr-x"
(cd "${out_dir}" && sha256sum "repohive-${version}.tar.gz" >"repohive-${version}.tar.gz.sha256")
rm -rf -- "${tree}"

printf 'bundle:   %s\n' "${bundle}"
printf 'sha256:   %s\n' "$(cut -d' ' -f1 "${bundle}.sha256")"
printf 'next:     deploy/scripts/deploy-app.sh %s\n' "${version}"
