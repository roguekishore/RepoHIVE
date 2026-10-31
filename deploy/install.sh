#!/usr/bin/env bash
# Run by deploy/activate.sh once per release, before the switch (DEPLOY-SPEC.md section 7): cwd = the new release, as
# root, env UNIT RELEASE ROLE RELEASE_DIR. The units run as repohive and caddy, so the release root must be enterable
# whatever mode the archive carried.
set -euo pipefail

: "${RELEASE_DIR:?install.sh runs from deploy/activate.sh (RELEASE_DIR unset)}"
chmod 0755 "${RELEASE_DIR}"

# cloud-init writes box.env and the units' memory limits on a box's first boot only (Terraform ignores later
# user_data). A box first booted before repohive-server replaced repohive-worker has neither of the server's, so they
# are added here with Terraform's defaults (server_node_heap_mb, server_memory_max_mb); the worker's stay, for a
# switch back.
if ! grep -q '^SERVER_NODE_HEAP_MB=' /etc/repohive/box.env; then
  echo 'SERVER_NODE_HEAP_MB=256' >>/etc/repohive/box.env
  echo "install.sh: added SERVER_NODE_HEAP_MB=256 to /etc/repohive/box.env"
fi
if [[ ! -f /etc/systemd/system/repohive-server.service.d/10-limits.conf ]]; then
  mkdir -p /etc/systemd/system/repohive-server.service.d
  printf '[Service]\nMemoryMax=384M\n' >/etc/systemd/system/repohive-server.service.d/10-limits.conf
  echo "install.sh: added repohive-server's MemoryMax=384M"
fi
