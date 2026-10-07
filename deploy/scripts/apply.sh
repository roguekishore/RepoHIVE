#!/usr/bin/env bash
# Applies one Terraform root for one account: init, plan to a file, then apply of that
# exact file. Stops unless the credentials are for the account in deploy/accounts/<name>/deploy.env.
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/apply.sh <bootstrap|main> [mode] [extra terraform plan arguments]
#
# Modes:
#   (none)          plan, print it, and apply it once someone types "apply" (a person at a terminal)
#   --plan-only     plan to <account folder>/out/<root>.tfplan, print the plan and a summary, and stop
#   --apply-saved   apply <account folder>/out/<root>.tfplan exactly as planned, then remove it; Terraform refuses a
#                   plan that is stale (the state changed since)
#   --destroy-plan  like --plan-only, for a destroy (teardown.sh uses it)
#
# Every value Terraform needs comes from the account's deploy.env, passed as -var: the account id, the site domain,
# OWNER_TAG, PROTECT, and ALERT_EMAIL (main) or the GitHub repository and OIDC provider (bootstrap). An optional
# <account folder>/<root>.tfvars adds tuning (prod.tfvars.example lists them). The bootstrap state, each root's
# working directory and the plans live in the account folder, so two accounts never share any of them. Extra
# arguments go to `terraform plan`, for example -var=indexer_image_digest=sha256:... (deploy.sh does this). A plan
# file can hold secrets; it stays in the git-ignored account folder.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

root="${1:-}"
case "${root}" in
  bootstrap | main) shift ;;
  *) die "usage: apply.sh <bootstrap|main> [--plan-only|--apply-saved|--destroy-plan] [extra terraform plan arguments]" ;;
esac
mode="interactive"
case "${1:-}" in
  --plan-only | --apply-saved | --destroy-plan)
    mode="${1#--}"
    shift
    ;;
esac

load_deploy_env
account_guard
tf_root_setup "${root}"

# Relative to the root directory for terraform, absolute for this script.
plan_file="${ACCOUNT_DIR_FROM_ROOT}/out/${root}.tfplan"
plan_path="${ACCOUNT_DIR}/out/${root}.tfplan"

summarise() {
  printf '\n== summary (%s, account %s) ==\n' "${root}" "${REPOHIVE_ACCOUNT}"
  terraform -chdir="${tf_dir}" show -no-color "${plan_file}" | grep -E '^  # |^Plan:|^No changes' || true
}

if [[ "${mode}" == "apply-saved" ]]; then
  [[ -f "${plan_path}" ]] || die "no saved plan at ${plan_path}; run apply.sh ${root} --plan-only first"
  terraform -chdir="${tf_dir}" init "${init_args[@]}" >/dev/null
  terraform -chdir="${tf_dir}" apply -input=false "${plan_file}"
  rm -f -- "${plan_path}"
  exit 0
fi

terraform -chdir="${tf_dir}" init "${init_args[@]}"
plan_args=(-input=false "${plan_vars[@]}" "-out=${plan_file}")
[[ "${mode}" == "destroy-plan" ]] && plan_args+=(-destroy)
terraform -chdir="${tf_dir}" plan "${plan_args[@]}" "$@"

if [[ "${mode}" == "plan-only" || "${mode}" == "destroy-plan" ]]; then
  summarise
  printf '\nSaved: %s\nApply it with: REPOHIVE_ACCOUNT=%s deploy/scripts/apply.sh %s --apply-saved\n' \
    "${plan_path}" "${REPOHIVE_ACCOUNT}" "${root}"
  exit 0
fi

printf '\nRead the plan above. Type "apply" to apply it, anything else to stop: '
read -r answer
if [[ "${answer}" != "apply" ]]; then
  rm -f -- "${plan_path}"
  die "not applied"
fi

terraform -chdir="${tf_dir}" apply -input=false "${plan_file}"
rm -f -- "${plan_path}"
