#!/usr/bin/env bash
# Before activation, in GitHub Actions (DEPLOY-SPEC.md section 6 and section 12 item 2):
#
#   deploy/precheck.sh <sha12> <path-to-tarball>
#
# The box's web app computes each job's snapshot id, and the indexer refuses one its own build would not compute. So
# the release must print the same snapshot inputs (build-identity.mjs) as the image the live Lambda runs. Runs it in
# both, the way verify-release.sh does: in the image (pulled by the digest Lambda resolved) and in the release tree.
# Exit 0: activate. Exit 1: the image is behind (or ahead); `deploy.sh infra` moves Lambda and Fargate to this build.
# Needs docker and the deploy role's credentials (lambda:GetFunction, ECR pull). Changes nothing.
set -euo pipefail

sha12="${1:?usage: deploy/precheck.sh <sha12> <tarball>}"
tarball="${2:?usage: deploy/precheck.sh <sha12> <tarball>}"

cd "$(git rev-parse --show-toplevel)"
die() {
  printf 'precheck: %s\n' "$*" >&2
  exit 1
}
region="${AWS_REGION:-ap-south-1}"
identity_script="${PWD}/deploy/scripts/build-identity.mjs"
[[ -f "${tarball}" ]] || die "${tarball} not found"

work="$(mktemp -d)"
trap 'rm -rf -- "${work}"' EXIT

if ! image="$(aws lambda get-function --function-name repohive-indexer --region "${region}" \
  --query Code.ResolvedImageUri --output text 2>"${work}/error")"; then
  if grep -q ResourceNotFoundException "${work}/error"; then
    printf 'precheck: no repohive-indexer function in this account yet; nothing to compare, passing\n'
    exit 0
  fi
  cat "${work}/error" >&2
  die "cannot read the live indexer function"
fi
[[ "${image}" == *@sha256:* ]] || die "the live function's image is '${image}', not a digest reference"

registry="${image%%/*}"
# The registry password goes through a pipe, never an argument.
aws ecr get-login-password --region "${region}" | docker login --username AWS --password-stdin "${registry}" >/dev/null
docker pull --quiet "${image}" >/dev/null
from_image="$(docker run --rm -v "${identity_script}:/var/task/build-identity.mjs:ro" --entrypoint node "${image}" \
  /var/task/build-identity.mjs)"

tree="${work}/release"
mkdir -p "${tree}"
tar -xzf "${tarball}" -C "${tree}"
web_dir="${tree}/app/packages/web"
cp "${identity_script}" "${web_dir}/build-identity.mjs"
from_bundle="$(cd "${web_dir}" && "${tree}/bin/node" build-identity.mjs)"

printf 'live image: %s\n%s:  %s\n' "${from_image}" "${sha12}" "${from_bundle}"
[[ -n "${from_bundle}" && "${from_bundle}" == "${from_image}" ]] ||
  die "the live indexer image and ${sha12} disagree on the snapshot inputs: run \`deploy.sh infra\` for ${sha12}, then \`./ops ship\` again"
printf 'precheck: ok, the live indexer image matches %s\n' "${sha12}"
