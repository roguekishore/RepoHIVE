#!/usr/bin/env bash
# Run by deploy/activate.sh after every switch of /opt/repohive/current, the switch back included (DEPLOY-SPEC.md
# section 7): cwd = the release that is now current, as root, env UNIT RELEASE ROLE RELEASE_DIR. activate.sh then
# restarts repohive-env, caddy, repohive-web and repohive-server (deploy/ops.env).
set -euo pipefail

: "${RELEASE_DIR:?after-switch.sh runs from deploy/activate.sh (RELEASE_DIR unset)}"

# Installs what ships in a release: units, the agent configuration, the scripts, the logrotate rule.
install_from_release() {
  local dir="$1"
  install -m 0644 "${dir}"/box/systemd/*.service /etc/systemd/system/
  install -m 0644 "${dir}"/box/systemd/*.timer /etc/systemd/system/
  install -m 0644 "${dir}/box/logrotate-repohive" /etc/logrotate.d/repohive
  install -m 0755 "${dir}/box/bin/repohive-env" /usr/local/sbin/repohive-env
  install -m 0755 "${dir}/box/bin/repohive-first-boot" /usr/local/sbin/repohive-first-boot
  if [[ -f "${dir}/box/bin/repohive-heartbeat" ]]; then
    install -m 0755 "${dir}/box/bin/repohive-heartbeat" /usr/local/sbin/repohive-heartbeat
  fi
  install -m 0644 "${dir}/box/amazon-cloudwatch-agent.json" /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
  systemctl daemon-reload
  systemctl enable --now repohive-heartbeat.timer
  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json >/dev/null
}

install_from_release "${RELEASE_DIR}"

# The box runs exactly the app units this release ships: any other repohive-*.service is stopped, disabled and removed
# (repohive-worker gave way to repohive-server), and each shipped unit with an [Install] section starts at boot. The
# same file, seeded into a release from before ./ops, makes a switch back to it restore that release's units.
for unit in /etc/systemd/system/repohive-*.service; do
  [[ -e "${unit}" ]] || continue
  name="$(basename "${unit}")"
  [[ "${name}" == "${UNIT:-repohive}-catchup.service" || -f "${RELEASE_DIR}/box/systemd/${name}" ]] && continue
  systemctl disable --now "${name}" >/dev/null 2>&1 || true
  rm -f -- "${unit}"
done
systemctl daemon-reload
for unit in "${RELEASE_DIR}"/box/systemd/*.service; do
  grep -q '^WantedBy=' "${unit}" || continue
  systemctl enable "$(basename "${unit}")" >/dev/null 2>&1
done
