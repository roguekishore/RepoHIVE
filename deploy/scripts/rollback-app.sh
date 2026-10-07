#!/usr/bin/env bash
# Switches the box back to the previous release, the same way a deploy switches
# forward: through SSM Run Command, running the activation script with --rollback. Stops unless the
# credentials are for the configured account.
#
#   deploy/scripts/rollback-app.sh
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_deploy_env
account_guard

run_on_box "/usr/local/sbin/repohive-activate --rollback"
