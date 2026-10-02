#!/usr/bin/env bash
# Prints an output of one Terraform root for one account, from that account's state. Reads state only; calls no
# other AWS API (the main root's state is in the account's state bucket, so its credentials are needed for that read).
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/tf-output.sh <bootstrap|main> [output name]
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

root="${1:-}"
case "${root}" in
  bootstrap | main) ;;
  *) die "usage: tf-output.sh <bootstrap|main> [output name]" ;;
esac
load_deploy_env
tf_root_setup "${root}"
terraform -chdir="${tf_dir}" init "${init_args[@]}" >/dev/null
if [[ -n "${2:-}" ]]; then
  terraform -chdir="${tf_dir}" output -json "$2" | jq .
else
  terraform -chdir="${tf_dir}" output
fi
