#!/usr/bin/env bash
# Builds the indexer image for linux/arm64 and tags it with the short git SHA of HEAD.
# Does not call AWS: the base images are pulled anonymously from public.ecr.aws.
#
#   deploy/scripts/build-indexer-image.sh
#
# Refuses a working tree with uncommitted changes under packages/, so the tag names what was built.
set -euo pipefail

# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_docker

if [[ -n "$(git -C "${REPO_ROOT}" status --porcelain -- packages)" ]]; then
  git -C "${REPO_ROOT}" status --short -- packages >&2
  die "uncommitted changes under packages/; commit or stash them first"
fi

tag="$(image_tag)"

# --provenance=false: Lambda rejects an image carrying a provenance attestation.
# --load: keep the image in the local daemon for run-indexer-image-locally.sh and push-indexer-image.sh.
docker buildx build \
  --platform linux/arm64 \
  --provenance=false \
  --load \
  -f "${REPO_ROOT}/packages/indexer/Dockerfile" \
  -t "${LOCAL_IMAGE_NAME}:${tag}" \
  "${REPO_ROOT}"

printf 'Built %s:%s\n' "${LOCAL_IMAGE_NAME}" "${tag}"
