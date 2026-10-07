#!/usr/bin/env bash
# The offline checks, and nothing that reaches AWS: terraform fmt -check,
# terraform validate on each root after init -backend=false, and shellcheck on every script under deploy/. Terraform
# runs with the AWS credential variables removed and the config files hidden. A tool that is not installed is
# reported as "not run", never as passed.
#
#   deploy/scripts/check.sh
#
# Exits non-zero if a check that ran failed. It contacts only the public Terraform registry.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

failures=0
not_run=()

pass() { printf 'ok       %s\n' "$*"; }
fail() {
  printf 'FAIL     %s\n' "$*"
  failures=$((failures + 1))
}
skip() {
  printf 'not run  %s\n' "$*"
  not_run+=("$1")
}

# Terraform with no AWS credentials in reach.
tf() {
  env -u AWS_PROFILE -u AWS_DEFAULT_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
    AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null terraform "$@"
}

cd "${REPO_ROOT}"

if command -v terraform >/dev/null 2>&1; then
  if tf fmt -check -recursive -diff deploy/terraform; then
    pass "terraform fmt -check -recursive deploy/terraform"
  else
    fail "terraform fmt -check -recursive deploy/terraform (the diff is above; fix it by hand)"
  fi
  for root in bootstrap main; do
    dir="deploy/terraform/${root}"
    if ! tf -chdir="${dir}" init -backend=false -input=false >/dev/null; then
      fail "terraform init -backend=false (${root}); on a platform other than the lock file's, run: terraform -chdir=${dir} providers lock -platform=<os_arch>"
    elif tf -chdir="${dir}" validate; then
      pass "terraform validate (${root})"
    else
      fail "terraform validate (${root})"
    fi
  done
else
  skip "terraform fmt and validate (terraform is not installed)"
fi

mapfile -t scripts < <(find deploy/scripts deploy/box -type f \( -name '*.sh' -o -path 'deploy/box/bin/*' \) | sort)
if ((${#scripts[@]} == 0)); then
  fail "no scripts found under deploy/"
elif command -v shellcheck >/dev/null 2>&1; then
  if shellcheck "${scripts[@]}"; then
    pass "shellcheck on ${#scripts[@]} scripts"
  else
    fail "shellcheck"
  fi
else
  skip "shellcheck on ${#scripts[@]} scripts (shellcheck is not installed)"
fi

if ((${#scripts[@]} > 0)); then
  syntax_failed=0
  for script in "${scripts[@]}"; do
    bash -n "${script}" || {
      printf 'bash -n failed: %s\n' "${script}"
      syntax_failed=1
    }
  done
  if ((syntax_failed == 0)); then pass "bash -n on ${#scripts[@]} scripts"; else fail "bash -n"; fi
fi

printf '\n%d failed, %d not run\n' "${failures}" "${#not_run[@]}"
((failures == 0))
