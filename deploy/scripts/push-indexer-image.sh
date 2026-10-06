#!/usr/bin/env bash
# Pushes the built indexer image to ECR and prints its digest.
#
#   AWS_PROFILE=<owner profile> deploy/scripts/push-indexer-image.sh [tag]
#
# The tag defaults to the short git SHA of HEAD, as build-indexer-image.sh made it. Lambda and the task definition
# reference the image by the printed digest, passed to Terraform as indexer_image_digest.
set -euo pipefail

# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REPOSITORY="repohive/indexer"

load_deploy_env
account_guard
require_docker

tag="${1:-$(image_tag)}"
registry="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
remote="${registry}/${REPOSITORY}:${tag}"

docker image inspect "${LOCAL_IMAGE_NAME}:${tag}" >/dev/null 2>&1 ||
  die "image ${LOCAL_IMAGE_NAME}:${tag} not found; run build-indexer-image.sh first"

# The registry password goes through a pipe, never an argument.
aws_cli ecr get-login-password | docker login --username AWS --password-stdin "${registry}" >/dev/null

docker tag "${LOCAL_IMAGE_NAME}:${tag}" "${remote}"
docker push "${remote}"

digest="$(aws_cli ecr describe-images \
  --repository-name "${REPOSITORY}" \
  --image-ids "imageTag=${tag}" \
  --query 'imageDetails[0].imageDigest' \
  --output text)"
[[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || die "ECR returned an unexpected digest: ${digest}"

printf 'Pushed %s\n' "${remote}"
printf 'indexer_image_digest = "%s"\n' "${digest}"
printf 'Image reference: %s/%s@%s\n' "${registry}" "${REPOSITORY}" "${digest}"
