#!/usr/bin/env bash
# Tests a built release bundle against the built indexer image, on a Linux arm64 host (the build workflow runs it;
# so can an owner's Graviton machine). No AWS: the app runs in local mode.
#
#   deploy/scripts/verify-release.sh [version]
#
# version defaults to the short git SHA of HEAD; it names deploy/out/repohive-<version>.tar.gz and the local image
# repohive-indexer:<version>. Checks, in order:
#   1. the bundle and the image compute the same snapshot inputs (engineVersion, viewsVersion, configDigest): if they
#      differ, every hosted job is refused with "snapshot id does not match this build";
#   2. the web server starts from the bundle with the bundle's own Node and /healthz answers ok;
#   3. the worker starts (TypeScript sources through Node's type stripping) and is still running after 20 s;
#   4. Caddy, from the bundle, adapts and validates the Caddyfile with placeholder settings.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

version="${1:-$(image_tag)}"
bundle="${DEPLOY_DIR}/out/repohive-${version}.tar.gz"
image="${LOCAL_IMAGE_NAME}:${version}"
[[ -f "${bundle}" ]] || die "${bundle} not found; run build-app-release.sh first"
require_docker
docker image inspect "${image}" >/dev/null 2>&1 || die "image ${image} not found; run build-indexer-image.sh first"
command -v curl >/dev/null 2>&1 || die "curl is required"
case "$(uname -s)/$(uname -m)" in
  Linux/aarch64 | Linux/arm64) ;;
  *) die "run this on Linux arm64: the bundle's node and caddy are arm64 Linux binaries" ;;
esac

work="$(mktemp -d)"
web_pid=""
cleanup() {
  if [[ -n "${web_pid}" ]]; then
    kill "${web_pid}" 2>/dev/null || true
    wait "${web_pid}" 2>/dev/null || true
  fi
  rm -rf -- "${work}"
}
trap cleanup EXIT

tree="${work}/release"
mkdir -p "${tree}" "${work}/data" "${work}/store"
tar -xzf "${bundle}" -C "${tree}"
web_dir="${tree}/app/packages/web"
node="${tree}/bin/node"
identity_script="${DEPLOY_DIR}/scripts/build-identity.mjs"

printf '== 1. snapshot inputs, bundle against image\n'
cp "${identity_script}" "${web_dir}/build-identity.mjs"
from_bundle="$(cd "${web_dir}" && "${node}" build-identity.mjs)"
rm -f "${web_dir}/build-identity.mjs"
from_image="$(docker run --rm -v "${identity_script}:/var/task/build-identity.mjs:ro" --entrypoint node "${image}" \
  /var/task/build-identity.mjs)"
printf 'bundle: %s\nimage:  %s\n' "${from_bundle}" "${from_image}"
[[ -n "${from_bundle}" && "${from_bundle}" == "${from_image}" ]] ||
  die "the bundle and the image disagree on the snapshot inputs; every hosted job would be refused"

# Local mode: a directory store, a file ledger, no orchestrator. Nothing here reaches AWS.
app_env=(
  "REPOHIVE_MODE=local"
  "REPOHIVE_SITE_ORIGIN=http://127.0.0.1:3100"
  "REPOHIVE_DATA_DIR=${work}/data"
  "REPOHIVE_STORE=local:${work}/store"
  "REPOHIVE_LEDGER=file:${work}/ledger.json"
  "REPOHIVE_ORCHESTRATOR=local"
  "NODE_ENV=production"
)

printf '== 2. web server and /healthz\n'
(cd "${web_dir}" && exec env "${app_env[@]}" PORT=3100 HOSTNAME=127.0.0.1 "${node}" server.js) >"${work}/web.log" 2>&1 &
web_pid=$!
body=""
for _ in $(seq 1 60); do
  body="$(curl -fsS --max-time 2 http://127.0.0.1:3100/healthz 2>/dev/null || true)"
  [[ "${body}" == *'"status":"ok"'* ]] && break
  kill -0 "${web_pid}" 2>/dev/null || break
  sleep 1
done
if [[ "${body}" != *'"status":"ok"'* ]]; then
  tail -n 40 "${work}/web.log" >&2
  die "the web server did not answer /healthz with ok (last answer: ${body:-none})"
fi
printf 'healthz: %s\n' "${body}"
status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3100/)"
[[ "${status}" == "200" ]] || {
  tail -n 40 "${work}/web.log" >&2
  die "GET / answered ${status}, not 200"
}
printf 'GET /: %s\n' "${status}"

printf '== 3. worker\n'
worker_status=0
(cd "${web_dir}" && exec env "${app_env[@]}" timeout 20 "${node}" --import ./scripts/register-aliases.mjs \
  scripts/run-worker.mjs) >"${work}/worker.log" 2>&1 || worker_status=$?
if [[ "${worker_status}" -ne 124 ]] || grep -q '"level":"error"' "${work}/worker.log"; then
  cat "${work}/worker.log" >&2
  die "the worker stopped with status ${worker_status} or logged an error (124 means it was still running)"
fi
printf 'worker: still running after 20 s, no error logged\n'

printf '== 4. Caddyfile\n'
# The real log path is /var/log/repohive; validate a copy that logs to the scratch directory instead.
sed "s#/var/log/repohive/#${work}/#" "${tree}/box/Caddyfile" >"${work}/Caddyfile"
caddy_env=(
  "ORIGIN_DOMAIN=origin.verify.repohive.dev"
  "SITE_DOMAIN=verify.repohive.dev"
  "ORIGIN_SECRET=verify-placeholder"
  "RATE_LIMIT_PER_MINUTE=300"
  "RATE_LIMIT_API_POST_PER_MINUTE=30"
  "XDG_DATA_HOME=${work}/caddy-data"
  "XDG_CONFIG_HOME=${work}/caddy-config"
)
env "${caddy_env[@]}" "${tree}/bin/caddy" adapt --config "${work}/Caddyfile" --adapter caddyfile >/dev/null
env "${caddy_env[@]}" "${tree}/bin/caddy" validate --config "${work}/Caddyfile" --adapter caddyfile
printf 'caddy: modules %s\n' "$("${tree}/bin/caddy" list-modules | grep -cE '^(http\.handlers\.rate_limit|http\.ip_sources\.cloudfront)$') of 2"
"${tree}/bin/caddy" list-modules | grep -qx 'http.handlers.rate_limit' || die "caddy lacks the rate_limit module"
"${tree}/bin/caddy" list-modules | grep -qx 'http.ip_sources.cloudfront' || die "caddy lacks the cloudfront ip source"

printf '\nverify-release: ok (%s)\n' "${version}"
