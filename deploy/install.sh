#!/usr/bin/env bash
# Run by deploy/activate.sh once per release, before the switch (DEPLOY-SPEC.md section 7): cwd = the new release, as
# root, env UNIT RELEASE ROLE RELEASE_DIR. The units run as repohive and caddy, so the release root must be enterable
# whatever mode the archive carried.
set -euo pipefail

: "${RELEASE_DIR:?install.sh runs from deploy/activate.sh (RELEASE_DIR unset)}"
chmod 0755 "${RELEASE_DIR}"
