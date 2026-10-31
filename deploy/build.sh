#!/usr/bin/env bash
# The release tarball, in GitHub Actions on arm64 (DEPLOY-SPEC.md section 5):
#
#   deploy/build.sh <sha12> <out-dir>
#
# Builds the indexer image and the app bundle, tests one against the other (verify-release.sh), pushes the image to the
# account's ECR (tag <sha12>; Lambda and Fargate move to it with `deploy.sh infra`), then repacks the bundle with
# deploy/activate.sh, ops.env, install.sh and after-switch.sh into <out-dir>/<sha12>.tar.gz. Uploads nothing else.
# Needs AWS_ACCOUNT_ID and VARS_JSON (the repository variables, SITE_DOMAIN among them) and the deploy role's
# credentials in the environment.
set -euo pipefail

sha12="${1:?usage: deploy/build.sh <sha12> <out-dir>}"
out="${2:?usage: deploy/build.sh <sha12> <out-dir>}"

cd "$(git rev-parse --show-toplevel)"
die() {
  printf 'build.sh: %s\n' "$*" >&2
  exit 1
}
[[ "${AWS_ACCOUNT_ID:-}" =~ ^[0-9]{12}$ ]] || die "AWS_ACCOUNT_ID is not a 12-digit account id"
site_domain="$(jq -r '.SITE_DOMAIN // empty' <<<"${VARS_JSON:-null}")"
[[ -n "${site_domain}" ]] || die "the repository variable SITE_DOMAIN is not set"

# The deploy scripts read an account folder; in Actions it is a throwaway one named ci (deploy/accounts/ is ignored).
mkdir -p deploy/accounts/ci
printf 'AWS_ACCOUNT_ID=%s\nSITE_DOMAIN=%s\n' "${AWS_ACCOUNT_ID}" "${site_domain}" >deploy/accounts/ci/deploy.env
export REPOHIVE_ACCOUNT=ci

deploy/scripts/build-indexer-image.sh
deploy/scripts/build-app-release.sh
deploy/scripts/verify-release.sh
deploy/scripts/push-indexer-image.sh

version="$(git rev-parse --short=12 HEAD)"
[[ "${version}" == "${sha12}" ]] || die "the bundle is version ${version}, the deploy is ${sha12}"
bundle="deploy/out/repohive-${version}.tar.gz"
[[ -f "${bundle}" ]] || die "${bundle} was not built"

tree="$(mktemp -d)"
trap 'rm -rf -- "${tree}"' EXIT
tar -xzf "${bundle}" -C "${tree}"
install -d -m 0755 "${tree}/deploy"
install -m 0755 deploy/activate.sh deploy/install.sh deploy/after-switch.sh "${tree}/deploy/"
install -m 0644 deploy/ops.env "${tree}/deploy/"
# The export directory is private (0700), and tar as root on the box restores the archive root's mode onto the
# release directory, which the repohive and caddy users must enter.
chmod 0755 "${tree}"

mkdir -p "${out}"
# The same flags as build-app-release.sh: sorted names, fixed owner and time, no gzip timestamp.
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='2000-01-01 00:00:00 UTC' \
  -C "${tree}" -cf - . | gzip -n -9 >"${out}/${sha12}.tar.gz"
root_mode="$(tar -tvzf "${out}/${sha12}.tar.gz" | sed -n 1p | cut -c1-10)"
[[ "${root_mode}" == "drwxr-xr-x" ]] || die "the tarball's root directory is ${root_mode}, not drwxr-xr-x"
printf 'build.sh: %s/%s.tar.gz\n' "${out}" "${sha12}"
