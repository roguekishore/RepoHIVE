#!/usr/bin/env bash
# The smoke test, through the site domain. It calls no AWS API and needs no credentials,
# only curl, and jq when a repository is given.
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/smoke.sh [<repository key>]   for example github.com/owner/repo, an index that exists
#
# Without a repository the checks that need a published snapshot are skipped, and the script says so.
# Exits non-zero if any check fails.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_deploy_env
command -v curl >/dev/null 2>&1 || die "curl is not installed"

repo="${1:-}"
site="https://${SITE_DOMAIN}"
origin="https://origin.${SITE_DOMAIN}"
failures=0

pass() { printf 'ok    %s\n' "$*"; }
fail() {
  printf 'FAIL  %s\n' "$*"
  failures=$((failures + 1))
}

# Status code, or 000 when the request did not complete.
status_of() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$@" 2>/dev/null || true
}

# One response header's value, lower-cased name, trailing CR removed. $1 is the header, the rest are curl arguments.
header_of() {
  local name="$1"
  shift
  curl -sS -D - -o /dev/null --max-time 20 "$@" 2>/dev/null |
    tr -d '\r' | sed -n "s/^${name}: //Ip" | head -n 1
}

# --- the app ------------------------------------------------------------------------------------------------------
body="$(curl -sS --max-time 20 "${site}/healthz" 2>/dev/null || true)"
if [[ "${body}" == *'"status":"ok"'* || "${body}" == *'"status": "ok"'* ]]; then
  pass "/healthz reports ok"
else
  fail "/healthz did not report ok"
fi

# --- views from the bucket -------------------------------------------------------------------------------------
snapshot_id=""
if [[ -n "${repo}" ]]; then
  command -v jq >/dev/null 2>&1 || die "jq is not installed"
  latest_url="${site}/r/${repo}/latest.json"
  latest_cache="$(header_of cache-control "${latest_url}")"
  if [[ "${latest_cache}" == "public, max-age=30, stale-while-revalidate=60" ]]; then
    pass "latest.json has the 30 s Cache-Control"
  else
    fail "latest.json Cache-Control is '${latest_cache}'"
  fi
  snapshot_id="$(curl -sS --max-time 20 "${latest_url}" 2>/dev/null | jq -r '.snapshotId // empty' 2>/dev/null || true)"
  if [[ -z "${snapshot_id}" ]]; then
    fail "latest.json did not name a snapshot"
  else
    manifest_url="${site}/s/${snapshot_id}/manifest.json"
    encoding="$(header_of content-encoding -H 'Accept-Encoding: br' "${manifest_url}")"
    cache="$(header_of cache-control -H 'Accept-Encoding: br' "${manifest_url}")"
    if [[ "${encoding}" == "br" ]]; then pass "a /s/ object answers with Content-Encoding: br"; else fail "a /s/ object has Content-Encoding '${encoding}'"; fi
    if [[ "${cache}" == "public, max-age=31536000, immutable" ]]; then pass "a /s/ object has the immutable Cache-Control"; else fail "a /s/ object has Cache-Control '${cache}'"; fi
  fi
else
  printf 'SKIP  snapshot checks (no repository given): latest.json headers, Content-Encoding, immutable Cache-Control\n'
fi

missing="$(status_of "${site}/s/no-such-snapshot/manifest.json")"
if [[ "${missing}" == "404" ]]; then pass "a missing /s/ key answers 404"; else fail "a missing /s/ key answered ${missing}"; fi

# --- nothing else is reachable --------------------------------------------------------------------------------------
# idx/, meta/ and backup/ have no behaviour: the request reaches the app, which has no such page. A 200 would mean an object came back.
for path in "/idx/${snapshot_id:-no-such-snapshot}/nodes.json" "/meta/${repo:-github.com/none/none}/history.json" "/backup/app.sqlite"; do
  code="$(status_of "${site}${path}")"
  if [[ "${code}" =~ ^4[0-9][0-9]$ ]]; then
    pass "${path} is not served (${code})"
  else
    fail "${path} answered ${code}, expected a 4xx"
  fi
done

# --- the origin refuses a direct request -----------------------------------------------------------------------------
# Without the origin secret the box answers 403, and from outside CloudFront the security group does not answer at all.
origin_code="$(status_of --max-time 10 "${origin}/healthz")"
case "${origin_code}" in
  403 | 000) pass "the origin domain refuses a direct request (${origin_code})" ;;
  *) fail "the origin domain answered ${origin_code} without the origin secret" ;;
esac

if ((failures > 0)); then
  die "${failures} smoke check(s) failed"
fi
printf 'smoke test passed\n'
