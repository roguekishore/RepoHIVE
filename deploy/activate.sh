#!/bin/bash
#
# deploy/activate.sh — switch this box to a release (shared, byte-identical in every unit).
#
#   activate.sh <sha12> <bucket> <role>     activate a release
#   activate.sh --catch-up                  boot mode, as /usr/local/sbin/<unit>-activate
#
# Runs as root, on the box, from SSM (the deploy workflow), from user-data, or from the catch-up
# unit at boot. Contract: DEPLOY-SPEC.md section 8. Everything unit-specific comes from the
# release's deploy/ops.env; the unit name comes from the bucket (<unit>-deploy-<account>).
#
# Exit: 0 live; 1 failed before the switch (box unchanged); 2 health failed, switched back to the
# previous release, which is healthy; 3 health failed and there was no healthy release to go back to.
# Every line it prints starts with "activate: "; the last one states the outcome.

set -euo pipefail

# One prefix for everything, including what install.sh, aws and systemctl print. Not again when
# the catch-up runs a downloaded copy of this script: its parent already prefixes.
if [[ -z "${ACTIVATE_PREFIXED:-}" ]]; then
  export ACTIVATE_PREFIXED=1
  exec > >(sed -u 's/^/activate: /') 2>&1
  PREFIX_PID=$!
  # Close our end and let sed print the last line before the exit code reaches SSM.
  trap 'exec >&- 2>&-; wait "$PREFIX_PID" 2>/dev/null || true' EXIT
fi

say() { echo "$*"; }
fail() { say "failed: $*"; exit 1; }

# The region of this instance, for the first download (before an ops.env is on the box).
imds_region() {
  local token
  token="$(curl -fsS -m 2 -X PUT http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" || return 1
  curl -fsS -m 2 -H "X-aws-ec2-metadata-token: $token" \
    http://169.254.169.254/latest/meta-data/placement/region
}

# A release's own activate.sh. A tarball packed from `.` (REPOHIVE's) names it ./deploy/activate.sh,
# and GNU tar matches member names literally.
extract_activate() {
  tar -xzOf "$1" deploy/activate.sh 2>/dev/null || tar -xzOf "$1" ./deploy/activate.sh
}

# ---------------------------------------------------------------------------
# --catch-up (section 8.4): at boot, before the services, move to the live release if the box
# is not on it. Always exits 0: a failed catch-up must not stop the services starting on what
# they have.
# ---------------------------------------------------------------------------
catch_up() {
  local unit env_file live current tmp
  unit="$(basename "$0")"
  unit="${unit%-activate}"
  env_file="/etc/ops/$unit.env"
  [[ -r "$env_file" ]] || { say "catch-up: $env_file missing, nothing to do"; return 0; }
  # shellcheck disable=SC1090
  . "$env_file"
  live="$(aws ssm get-parameter --name "/$UNIT/release" --region "$REGION" \
    --query Parameter.Value --output text 2>&1)" || { say "catch-up: cannot read /$UNIT/release: $live"; return 0; }
  if [[ ! "$live" =~ ^[0-9a-f]{12}$ ]]; then
    say "catch-up: /$UNIT/release is '$live', not a release; staying"
    return 0
  fi
  current="$(basename "$(readlink -e "/opt/$UNIT/current" 2>/dev/null || true)")"
  if [[ "$live" == "$current" ]]; then
    say "catch-up: $UNIT already on $live"
    return 0
  fi
  say "catch-up: $UNIT is on '${current:-nothing}', live is $live"
  tmp="$(mktemp -d /var/tmp/"$UNIT"-catchup.XXXXXX)"
  if aws s3 cp "s3://$BUCKET/releases/$live.tar.gz" "$tmp/release.tar.gz" --region "$REGION" --only-show-errors \
     && extract_activate "$tmp/release.tar.gz" > "$tmp/activate.sh"; then
    rm -f "$tmp/release.tar.gz"
    local code=0
    bash "$tmp/activate.sh" "$live" "$BUCKET" "$ROLE" || code=$?
    say "catch-up: activate exited $code"
  else
    say "catch-up: could not fetch $live's activate.sh"
  fi
  rm -rf "$tmp"
  return 0
}

if [[ "${1:-}" == "--catch-up" ]]; then
  catch_up
  say "catch-up: done"
  exit 0
fi

# ---------------------------------------------------------------------------
# 0. Arguments, lock.
# ---------------------------------------------------------------------------
[[ $# -eq 3 ]] || fail "usage: activate.sh <sha12> <bucket> <role> | --catch-up"
SHA12="$1" BUCKET="$2" ROLE="$3"
[[ "$SHA12" =~ ^[0-9a-f]{12}$ ]] || fail "bad sha12 '$SHA12'"
[[ "$BUCKET" =~ ^[a-z0-9-]+$ ]] || fail "bad bucket '$BUCKET'"
[[ "$ROLE" =~ ^[a-z0-9_]+$ ]] || fail "bad role '$ROLE'"
UNIT="${BUCKET%-deploy-*}"
[[ "$UNIT" != "$BUCKET" && -n "$UNIT" ]] || fail "bucket '$BUCKET' is not <unit>-deploy-<account>"

exec 9> "/run/$UNIT-activate.lock"
flock 9 || fail "cannot lock /run/$UNIT-activate.lock"

ROOT="/opt/$UNIT"
D="$ROOT/releases/$SHA12"
mkdir -p "$ROOT/releases"

# Loads ops.env from a release folder into the variables below. The role decides which
# SERVICES_/HEALTH_ pair applies.
load_ops_env() {
  local dir="$1" services_var health_var
  [[ -f "$dir/deploy/ops.env" ]] || return 1
  # shellcheck disable=SC1091
  . "$dir/deploy/ops.env"
  services_var="SERVICES_$ROLE" health_var="HEALTH_$ROLE"
  SERVICES="${!services_var:-}"
  HEALTH="${!health_var:-}"
  HEALTH_SECONDS="${HEALTH_SECONDS:-60}"
}

# ---------------------------------------------------------------------------
# 1–2. The release folder: reuse an installed one (D11), else download, check, unpack.
# ---------------------------------------------------------------------------
if [[ -f "$D/.installed" ]]; then
  say "$SHA12 already installed, switching only"
else
  region="$(imds_region)" || region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
  [[ -n "$region" ]] || fail "cannot tell this instance's region"
  tmp="$(mktemp -d /var/tmp/"$UNIT"-release.XXXXXX)"
  say "downloading $SHA12 from $BUCKET"
  aws s3 cp "s3://$BUCKET/releases/$SHA12.tar.gz" "$tmp/release.tar.gz" --region "$region" --only-show-errors \
    || { rm -rf "$tmp"; fail "download of $SHA12.tar.gz"; }
  aws s3 cp "s3://$BUCKET/releases/$SHA12.tar.gz.sha256" "$tmp/release.tar.gz.sha256" --region "$region" --only-show-errors \
    || { rm -rf "$tmp"; fail "download of $SHA12.tar.gz.sha256"; }
  expected="$(awk '{print $1}' "$tmp/release.tar.gz.sha256")"
  actual="$(sha256sum "$tmp/release.tar.gz" | awk '{print $1}')"
  [[ "$expected" == "$actual" ]] || { rm -rf "$tmp"; fail "sha256 mismatch for $SHA12 (expected $expected, got $actual)"; }
  # A folder without .installed is a failed earlier try, or one an older pipeline unpacked (it may be
  # the one current points at): replace it from the tarball, renamed aside rather than deleted first.
  rm -rf "$D.partial" "$D.stale"
  mkdir -p "$D.partial"
  tar -xzf "$tmp/release.tar.gz" -C "$D.partial" || { rm -rf "$tmp" "$D.partial"; fail "unpack of $SHA12"; }
  rm -rf "$tmp"
  [[ ! -e "$D" ]] || mv -T "$D" "$D.stale"
  mv -T "$D.partial" "$D"
  rm -rf "$D.stale"
fi

BUCKET_UNIT="$UNIT"
load_ops_env "$D" || fail "$SHA12 has no deploy/ops.env"
[[ "$UNIT" == "$BUCKET_UNIT" ]] || fail "$SHA12's ops.env says UNIT=$UNIT, the bucket says $BUCKET_UNIT"
[[ -n "$SERVICES" ]] || fail "role '$ROLE' has no SERVICES_$ROLE in $SHA12's ops.env"
[[ -n "$HEALTH" ]] || fail "role '$ROLE' has no HEALTH_$ROLE in $SHA12's ops.env"

# Step 0's box state, now that ops.env is known: the catch-up's settings, this script as
# /usr/local/sbin/<unit>-activate, and the catch-up unit.
install -d -m 0755 /etc/ops
cat > "/etc/ops/$UNIT.env" <<ENV
UNIT=$UNIT
BUCKET=$BUCKET
REGION=$REGION
ROLE=$ROLE
ENV
self="$(readlink -f "${BASH_SOURCE[0]}")"
if [[ "$self" != "/usr/local/sbin/$UNIT-activate" ]]; then
  install -m 0755 "$self" "/usr/local/sbin/$UNIT-activate"
fi
cat > "/etc/systemd/system/$UNIT-catchup.service" <<UNITFILE
[Unit]
Description=$UNIT: switch to the live release at boot
Wants=network-online.target
After=network-online.target
Before=$SERVICES
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/$UNIT-activate --catch-up
TimeoutStartSec=1800
[Install]
WantedBy=multi-user.target
UNITFILE
systemctl daemon-reload
systemctl enable "$UNIT-catchup.service" >/dev/null 2>&1 || say "warning: could not enable $UNIT-catchup.service"

# ---------------------------------------------------------------------------
# 3. install.sh, once per release.
# ---------------------------------------------------------------------------
if [[ ! -f "$D/.installed" ]]; then
  say "install.sh for $SHA12 ($ROLE)"
  ( cd "$D" && UNIT="$UNIT" RELEASE="$SHA12" ROLE="$ROLE" RELEASE_DIR="$D" bash deploy/install.sh ) \
    || fail "install.sh for $SHA12 exited non-zero; nothing switched"
  touch "$D/.installed"
fi

# ---------------------------------------------------------------------------
# 4. Switch, after-switch, restart.
# ---------------------------------------------------------------------------
switch_to() {
  local dir="$1" rel
  rel="$(basename "$dir")"
  ln -sfn "$dir" "$ROOT/current.new"
  mv -T "$ROOT/current.new" "$ROOT/current"
  touch "$dir/.installed"
  say "current -> $rel"
  if [[ -f "$dir/deploy/after-switch.sh" ]]; then
    ( cd "$dir" && UNIT="$UNIT" RELEASE="$rel" ROLE="$ROLE" RELEASE_DIR="$dir" bash deploy/after-switch.sh ) \
      || say "warning: after-switch.sh for $rel exited non-zero"
  fi
  local svc
  for svc in $SERVICES; do
    systemctl restart "$svc" || say "warning: restart of $svc failed"
  done
}

healthy() {
  local deadline=$((SECONDS + HEALTH_SECONDS))
  while :; do
    if timeout 30 bash -c "$HEALTH" >/dev/null 2>&1; then return 0; fi
    (( SECONDS < deadline )) || return 1
    sleep 2
  done
}

PREVIOUS="$(readlink -e "$ROOT/current" 2>/dev/null || true)"
switch_to "$D"

# ---------------------------------------------------------------------------
# 5. Health, and the switch back.
# ---------------------------------------------------------------------------
if ! healthy; then
  say "health check failed for $SHA12 after ${HEALTH_SECONDS}s"
  if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$D" ]]; then
    prev="$(basename "$PREVIOUS")"
    say "switching back to $prev"
    # The previous release's own services and health check, when it has an ops.env (a release
    # from before this pipeline has none; then this release's values stand).
    load_ops_env "$PREVIOUS" || true
    switch_to "$PREVIOUS"
    if healthy; then
      say "health failed, reverted to $prev"
      exit 2
    fi
    say "health failed, and $prev is unhealthy too: needs you"
    exit 3
  fi
  say "health failed and there is no previous release: needs you"
  exit 3
fi

# ---------------------------------------------------------------------------
# 6. Prune: the 3 most recently activated releases, plus current; never current.
# ---------------------------------------------------------------------------
# A folder without .installed (a release from before this pipeline) sorts oldest.
current="$(readlink -e "$ROOT/current")"
kept=0
while IFS= read -r line; do
  dir="${line#* }"
  if (( kept < 3 )); then kept=$((kept + 1)); continue; fi
  [[ "$dir" == "$current" ]] && continue
  say "pruning $(basename "$dir")"
  rm -rf "$dir"
done < <(
  for dir in "$ROOT"/releases/*/; do
    dir="${dir%/}"
    [[ -d "$dir" && "$dir" != *.partial && "$dir" != *.stale ]] || continue
    printf '%s %s\n' "$(stat -c '%Y' "$dir/.installed" 2>/dev/null || echo 0)" "$dir"
  done | sort -rn
)
say "$UNIT $SHA12 live on $ROLE"
exit 0
