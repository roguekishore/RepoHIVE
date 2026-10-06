#!/usr/bin/env bash
# Tests a built release bundle against the built indexer image, on a Linux arm64 host (the build workflow runs it;
# so can an owner's Graviton machine). No AWS: the server runs in local mode.
#
#   deploy/scripts/verify-release.sh [version]
#
# version defaults to the short git SHA of HEAD; it names deploy/out/repohive-<version>.tar.gz and the local image
# repohive-indexer:<version>. Checks, in order:
#   1. the bundle's pre-check and the image compute the same snapshot inputs (engineVersion, viewsVersion,
#      configDigest): if they differ, every hosted job is refused with "snapshot id does not match this build";
#   2. the server starts from the bundle with the bundle's own Java, /healthz answers ok, the exported viewer is
#      served, and a request that needs the pre-check child (the bundle's Node and indexer) is answered;
#   3. the bundle's Caddy serves the viewer with the host mapping, request by request (check-spa-mapping.mjs);
#   4. Caddy, from the bundle, adapts and validates the Caddyfile with placeholder settings and has both modules.
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
  *) die "run this on Linux arm64: the bundle's java, node and caddy are arm64 Linux binaries" ;;
esac

work="$(mktemp -d)"
server_pid=""
cleanup() {
  if [[ -n "${server_pid}" ]]; then
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
  fi
  rm -rf -- "${work}"
}
trap cleanup EXIT

tree="${work}/release"
mkdir -p "${tree}" "${work}/data" "${work}/store"
tar -xzf "${bundle}" -C "${tree}"
node="${tree}/bin/node"
identity_script="${DEPLOY_DIR}/scripts/build-identity.mjs"

printf '== 1. snapshot inputs, bundle against image\n'
# The bundle's indexer directory has the same layout as the image's /var/task: dist/ beside the script, the compiled
# packages in node_modules.
cp "${identity_script}" "${tree}/indexer/build-identity.mjs"
from_bundle="$(cd "${tree}/indexer" && "${node}" build-identity.mjs)"
rm -f "${tree}/indexer/build-identity.mjs"
from_image="$(docker run --rm -v "${identity_script}:/var/task/build-identity.mjs:ro" --entrypoint node "${image}" \
  /var/task/build-identity.mjs)"
printf 'bundle: %s\nimage:  %s\n' "${from_bundle}" "${from_image}"
[[ -n "${from_bundle}" && "${from_bundle}" == "${from_image}" ]] ||
  die "the bundle and the image disagree on the snapshot inputs; every hosted job would be refused"

printf '== 2. server, pre-check child and the viewer\n'
# Local mode: a directory store, no orchestrator, the exported viewer served by the server itself. Nothing here
# reaches AWS. The working directory holds no config/ folder, as on the box.
site="http://127.0.0.1:3100"
server_env=(
  "REPOHIVE_MODE=local"
  "REPOHIVE_SITE_ORIGIN=${site}"
  "REPOHIVE_DATA_DIR=${work}/data"
  "REPOHIVE_STORE=local:${work}/store"
  "REPOHIVE_ORCHESTRATOR=local"
  "REPOHIVE_INTERNAL_SECRET=verify-internal-secret"
  "REPOHIVE_INDEXER_DIR=${tree}/indexer"
  "REPOHIVE_NODE=${node}"
  "REPOHIVE_WEB_DIR=${tree}/web"
  "SERVER_ADDRESS=127.0.0.1"
  "SERVER_PORT=3100"
)
(cd "${work}" && exec env "${server_env[@]}" "${tree}/java/bin/java" -Xmx512m -jar "${tree}/server/repohive-server.jar") \
  >"${work}/server.log" 2>&1 &
server_pid=$!
body=""
for _ in $(seq 1 90); do
  body="$(curl -fsS --max-time 2 "${site}/healthz" 2>/dev/null || true)"
  [[ "${body}" == *'"status":"ok"'* ]] && break
  kill -0 "${server_pid}" 2>/dev/null || break
  sleep 1
done
if [[ "${body}" != *'"status":"ok"'* ]]; then
  tail -n 60 "${work}/server.log" >&2
  die "the server did not answer /healthz with ok (last answer: ${body:-none})"
fi
printf 'healthz: %s\n' "${body}"
for path in / /repos/someone/something/hierarchy /jobs/0123abcd /auth/sign-in; do
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${site}${path}")"
  [[ "${status}" == "200" ]] || {
    tail -n 40 "${work}/server.log" >&2
    die "GET ${path} answered ${status}, not 200"
  }
done
printf 'viewer pages: 200\n'

# A request the pre-check must judge runs the bundle's Node on the bundle's indexer: sign up, then ask for a local
# fixture that does not exist. Only the pre-check child can answer NOT_FOUND here (the server's own name check says
# INVALID_REPOSITORY), and in local mode it answers from the fixture directory without reaching GitHub. A crash is a 500.
jar="${work}/cookies.txt"
signup="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -c "${jar}" -H "Origin: ${site}" -H 'Content-Type: application/json' \
  -d '{"email":"verify@example.com","password":"password-ten-chars"}' "${site}/api/auth/sign-up")"
[[ "${signup}" == "201" ]] || die "sign-up answered ${signup}, not 201"
index_status="$(curl -s -o "${work}/index.json" -w '%{http_code}' --max-time 60 -b "${jar}" -H "Origin: ${site}" \
  -H 'Content-Type: application/json' -d '{"repo":"local/verify-missing"}' "${site}/api/index")"
if [[ "${index_status}" == "500" || "$(cat "${work}/index.json")" != *'"code":"NOT_FOUND"'* ]]; then
  tail -n 40 "${work}/server.log" >&2
  die "POST /api/index answered ${index_status} ($(cat "${work}/index.json")); the pre-check child did not judge it"
fi
printf 'pre-check child: answered %s, NOT_FOUND as expected\n' "${index_status}"
kill "${server_pid}" 2>/dev/null || true
wait "${server_pid}" 2>/dev/null || true
server_pid=""

printf '== 3. the bundle'"'"'s Caddy serves the viewer with the host mapping\n'
"${node}" "${DEPLOY_DIR}/scripts/check-spa-mapping.mjs" "${tree}/bin/caddy" "${tree}/web" 3101

printf '== 4. Caddyfile\n'
# The real log path is /var/log/repohive; validate a copy that logs to the scratch directory instead. spa.caddy is
# imported from beside the Caddyfile, so it comes along.
sed "s#/var/log/repohive/#${work}/#" "${tree}/box/Caddyfile" >"${work}/Caddyfile"
cp "${tree}/box/spa.caddy" "${work}/spa.caddy"
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
