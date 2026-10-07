#!/usr/bin/env bash
# Removes everything RepoHIVE created in one account (runbook "Teardown"), for an account whose deploy.env says
# PROTECT=false: a test account. It deletes data for good: the SQLite volume, the ledger, every snapshot, the release
# bundles, the images and the Terraform state. A production account (PROTECT=true) is refused.
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/teardown.sh --confirm <12-digit account id>
#
# Order: the main root is applied once with protection off and then destroyed, except the data volume (prevent_destroy),
# which is taken out of the state and deleted directly; then the GitHub token parameter; then the bootstrap root the same
# way, except the state bucket (prevent_destroy), which is emptied of every version and deleted directly; last the
# account's GitHub environment. Each step can be run again after a failure. DNS records stay: remove them in Netlify.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[[ "${1:-}" == "--confirm" && -n "${2:-}" ]] || die "usage: teardown.sh --confirm <account id>"
load_deploy_env
[[ "${2}" == "${AWS_ACCOUNT_ID}" ]] || die "--confirm ${2} is not the account in deploy.env (${AWS_ACCOUNT_ID})"
[[ "${PROTECT}" == "false" ]] || die "PROTECT is not false in deploy.env: this account is protected, nothing was removed"
account_guard
command -v jq >/dev/null 2>&1 || die "jq is required"
scripts="${DEPLOY_DIR}/scripts"
# Any well-formed digest serves a destroy; the protection-off apply keeps the function's current one.
placeholder_digest="sha256:$(printf '0%.0s' $(seq 1 64))"

current_digest() {
  local uri
  uri="$(aws_cli lambda get-function --function-name repohive-indexer --query Code.ImageUri --output text 2>/dev/null || true)"
  if [[ "${uri}" == *@sha256:* ]]; then printf '%s' "sha256:${uri##*@sha256:}"; else printf '%s' "${placeholder_digest}"; fi
}

tf() { terraform -chdir="${tf_dir}" "$@"; }

# Deletes every object version and delete marker of a bucket, then the bucket. A missing bucket is fine.
delete_versioned_bucket() {
  local bucket="$1" batch
  aws_cli s3api head-bucket --bucket "${bucket}" >/dev/null 2>&1 || return 0
  while :; do
    batch="$(aws_cli s3api list-object-versions --bucket "${bucket}" --output json |
      jq -c '{Objects: ([(.Versions // [])[], (.DeleteMarkers // [])[]] | map({Key, VersionId}) | .[0:1000]), Quiet: true}')"
    [[ "$(jq '.Objects | length' <<<"${batch}")" -gt 0 ]] || break
    aws_cli s3api delete-objects --bucket "${bucket}" --delete "${batch}" >/dev/null
  done
  aws_cli s3api delete-bucket --bucket "${bucket}"
  printf 'deleted bucket %s\n' "${bucket}"
}

# True when the root's state lists at least one resource. An empty state is skipped, never planned: planning the
# protection-off apply against an empty state would create the whole stack.
state_has_resources() {
  tf_root_setup "$1"
  tf init "${init_args[@]}" >/dev/null
  [[ -n "$(tf state list)" ]]
}

# --- main root ----------------------------------------------------------------------------------------------------
if aws_cli s3api head-object --bucket "${STATE_BUCKET}" --key main/terraform.tfstate >/dev/null 2>&1 &&
  state_has_resources main; then
  printf '== main: protection off\n'
  digest="$(current_digest)"
  "${scripts}/apply.sh" main --plan-only "-var=indexer_image_digest=${digest}"
  "${scripts}/apply.sh" main --apply-saved

  tf_root_setup main
  tf init "${init_args[@]}" >/dev/null
  volume_id=""
  if tf state list | grep -qx 'aws_ebs_volume.data'; then
    volume_id="$(tf state show -no-color aws_ebs_volume.data | sed -n 's/^ *id *= *"\(vol-[0-9a-f]*\)"$/\1/p')"
    tf state rm aws_ebs_volume.data >/dev/null
    printf 'took the data volume %s out of the state\n' "${volume_id}"
  fi

  printf '== main: destroy\n'
  "${scripts}/apply.sh" main --destroy-plan "-var=indexer_image_digest=${digest}"
  "${scripts}/apply.sh" main --apply-saved

  if [[ -z "${volume_id}" ]]; then
    volume_id="$(aws_cli ec2 describe-volumes --filters Name=tag:Name,Values=repohive-data \
      --query 'Volumes[0].VolumeId' --output text 2>/dev/null || true)"
    [[ "${volume_id}" == vol-* ]] || volume_id=""
  fi
  if [[ -n "${volume_id}" ]]; then
    aws_cli ec2 wait volume-available --volume-ids "${volume_id}"
    aws_cli ec2 delete-volume --volume-id "${volume_id}"
    printf 'deleted the data volume %s\n' "${volume_id}"
  fi
else
  printf '== main: no resources in its state, nothing to destroy\n'
fi

if aws_cli ssm delete-parameter --name /repohive/github-token >/dev/null 2>&1; then
  printf 'deleted the parameter /repohive/github-token\n'
fi

# --- bootstrap root -----------------------------------------------------------------------------------------------
if [[ -f "${ACCOUNT_DIR}/bootstrap.tfstate" ]] && state_has_resources bootstrap; then
  printf '== bootstrap: protection off\n'
  "${scripts}/apply.sh" bootstrap --plan-only
  "${scripts}/apply.sh" bootstrap --apply-saved

  tf_root_setup bootstrap
  tf init "${init_args[@]}" >/dev/null
  if tf state list | grep -qx 'aws_s3_bucket.state'; then
    tf state rm aws_s3_bucket.state >/dev/null
  fi

  printf '== bootstrap: destroy\n'
  "${scripts}/apply.sh" bootstrap --destroy-plan
  "${scripts}/apply.sh" bootstrap --apply-saved
fi
delete_versioned_bucket "${STATE_BUCKET}"

# --- GitHub -------------------------------------------------------------------------------------------------------
if command -v gh >/dev/null 2>&1; then
  if gh api --silent -X DELETE "repos/$(github_repository)/environments/${REPOHIVE_ACCOUNT}" 2>/dev/null; then
    printf 'deleted the GitHub environment %s\n' "${REPOHIVE_ACCOUNT}"
  fi
fi

printf '\nteardown of %s (%s): done. Remove the Netlify DNS records of %s and its certificate validation.\n' \
  "${REPOHIVE_ACCOUNT}" "${AWS_ACCOUNT_ID}" "${SITE_DOMAIN}"
