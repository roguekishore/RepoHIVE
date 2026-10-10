#!/usr/bin/env bash
# The smoke test, through the site domain. It calls no AWS API and needs no credentials,
# only curl, and jq when a repository is given.
#
#   REPOHIVE_ACCOUNT=<name> deploy/scripts/smoke.sh [<repository>]   for example owner/repo or github.com/owner/repo, an index that exists
#
# Without a repository the checks that need a published snapshot are skipped, and the script says so.
# Exits non-zero if any check fails.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_deploy_env
command -v curl >/dev/null 2>&1 || die "curl is not installed"

repo="${1:-}"
repo="${repo#https://}"
repo="${repo#github.com/}"
repo="$(printf '%s' "${repo}" | tr '[:upper:]' '[:lower:]')"
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

# --- the server -----------------------------------------------------------------------------------------------------
body="$(curl -sS --max-time 20 "${site}/healthz" 2>/dev/null || true)"
if [[ "${body}" == *'"status":"ok"'* || "${body}" == *'"status": "ok"'* ]]; then
  pass "/healthz reports ok"
else
  fail "/healthz did not report ok"
fi

# The workers reach the server through the same door as visitors; without the bearer secret it must refuse them.
internal="$(status_of -X POST -H 'Content-Type: application/json' -d '{}' "${site}/api/internal/jobs/progress")"
case "${internal}" in
  401 | 403) pass "/api/internal/jobs/progress refuses a call without the secret (${internal})" ;;
  *) fail "/api/internal/jobs/progress answered ${internal} without the secret, expected 401 or 403" ;;
esac

# The limits page's calls: a PUT reaches the server (its JSON answer, not CloudFront's HTML refusal of the method),
# and with no admin token stored or none sent it is 401 or 404, never 200.
admin_code="$(status_of -X PUT -H 'Content-Type: application/json' -d '{}' "${site}/api/admin/limits")"
admin_type="$(header_of content-type -X PUT -H 'Content-Type: application/json' -d '{}' "${site}/api/admin/limits")"
if [[ "${admin_code}" =~ ^(401|404)$ && "${admin_type}" == application/json* ]]; then
  pass "PUT /api/admin/limits reaches the server and is refused (${admin_code})"
else
  fail "PUT /api/admin/limits answered ${admin_code} (${admin_type}), expected the server's 401 or 404 as JSON"
fi

# --- the viewer, from the box ----------------------------------------------------------------------------------------
for path in / /repos/someone/something/hierarchy /jobs/0123abcd /auth/sign-in; do
  code="$(status_of "${site}${path}")"
  if [[ "${code}" == "200" ]]; then pass "${path} serves the viewer"; else fail "${path} answered ${code}, expected 200"; fi
done
code="$(status_of "${site}/no-such-page")"
if [[ "${code}" == "404" ]]; then pass "an unknown page answers 404"; else fail "an unknown page answered ${code}"; fi
cache="$(header_of cache-control "${site}/")"
if [[ "${cache}" == "no-cache" ]]; then pass "pages are revalidated (Cache-Control: no-cache)"; else fail "the dashboard has Cache-Control '${cache}'"; fi

# --- snapshot objects, from the bucket -------------------------------------------------------------------------------
snapshot_id=""
if [[ -n "${repo}" ]]; then
  command -v jq >/dev/null 2>&1 || die "jq is not installed"
  repo_json="$(curl -sS --max-time 20 "${site}/api/repos/${repo}" 2>/dev/null || true)"
  snapshot_id="$(jq -r '.snapshotId // empty' <<<"${repo_json}" 2>/dev/null || true)"
  if [[ -z "${snapshot_id}" ]]; then
    fail "/api/repos/${repo} did not name a snapshot: ${repo_json:0:200}"
  else
    pass "/api/repos/${repo} names snapshot ${snapshot_id}"
    manifest_url="${site}/artifacts/${repo}/${snapshot_id}/manifest.json"
    encoding="$(header_of content-encoding -H 'Accept-Encoding: br' "${manifest_url}")"
    cache="$(header_of cache-control -H 'Accept-Encoding: br' "${manifest_url}")"
    if [[ "${encoding}" == "br" ]]; then pass "an /artifacts/ object answers with Content-Encoding: br"; else fail "an /artifacts/ object has Content-Encoding '${encoding}'"; fi
    if [[ "${cache}" == "public, max-age=31536000, immutable" ]]; then pass "an /artifacts/ object has the immutable Cache-Control"; else fail "an /artifacts/ object has Cache-Control '${cache}'"; fi
  fi
else
  printf 'SKIP  snapshot checks (no repository given): the active snapshot, Content-Encoding, immutable Cache-Control\n'
fi

missing="$(status_of "${site}/artifacts/no-such-owner/no-such-repo/00000000000000000000000000000000/manifest.json")"
if [[ "${missing}" == "404" ]]; then pass "a missing /artifacts/ key answers 404"; else fail "a missing /artifacts/ key answered ${missing}"; fi

# --- nothing else is reachable --------------------------------------------------------------------------------------
# private/ (the compact index, the pruning record) and backup/ have no behaviour: the request reaches the box, which
# has no such page. A 200 would mean an object came back.
for path in "/private/${repo:-none/none}/${snapshot_id:-00000000000000000000000000000000}/index/nodes.json" \
  "/private/${repo:-none/none}/history.json" "/backup/app.sqlite"; do
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
