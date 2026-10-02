#!/usr/bin/env bash
# Applies one Terraform root (hosting-4 Requirement 18.4): init, plan to a file, then apply of that exact file
# once the owner types "apply". Stops unless the credentials are for the configured account and the root's
# prod.tfvars names the same account.
#
#   AWS_PROFILE=<owner profile> deploy/scripts/apply.sh <bootstrap|main> [extra terraform plan arguments]
#
# The main root needs deploy/terraform/main/backend.hcl (copy backend.hcl.example). Extra arguments go to
# `terraform plan`, for example -var=indexer_image_digest=sha256:... (deploy.sh does this). The plan file can
# hold secrets, so it lives in the git-ignored deploy/out/ and is removed after the apply.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

root="${1:-}"
case "${root}" in
  bootstrap | main) shift ;;
  *) die "usage: apply.sh <bootstrap|main> [extra terraform plan arguments]" ;;
esac

load_deploy_env
account_guard
command -v terraform >/dev/null 2>&1 || die "terraform is not installed"

tf_dir="${DEPLOY_DIR}/terraform/${root}"
var_file="${tf_dir}/prod.tfvars"
[[ -f "${var_file}" ]] || die "${var_file} not found; copy prod.tfvars.example and fill it in"

tfvars_account="$(sed -n 's/^[[:space:]]*aws_account_id[[:space:]]*=[[:space:]]*"\([0-9]*\)".*/\1/p' "${var_file}")"
[[ "${tfvars_account}" == "${AWS_ACCOUNT_ID}" ]] ||
  die "aws_account_id in ${var_file} (${tfvars_account:-unset}) is not the configured account ${AWS_ACCOUNT_ID}"

mkdir -p "${DEPLOY_DIR}/out"
plan_file="${DEPLOY_DIR}/out/${root}.tfplan"

init_args=(-input=false)
if [[ "${root}" == "main" ]]; then
  backend_file="${tf_dir}/backend.hcl"
  [[ -f "${backend_file}" ]] || die "${backend_file} not found; copy backend.hcl.example and fill it in"
  init_args+=("-backend-config=${backend_file}")
fi

terraform -chdir="${tf_dir}" init "${init_args[@]}"
terraform -chdir="${tf_dir}" plan -input=false "-var-file=${var_file}" "-out=${plan_file}" "$@"

printf '\nRead the plan above. Type "apply" to apply it, anything else to stop: '
read -r answer
if [[ "${answer}" != "apply" ]]; then
  rm -f -- "${plan_file}"
  die "not applied"
fi

terraform -chdir="${tf_dir}" apply -input=false "${plan_file}"
rm -f -- "${plan_file}"
