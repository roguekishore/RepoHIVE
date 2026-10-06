#!/bin/sh
# Checks an assembled release tree: the server jar and
# its Java runtime, the exported viewer, Caddy, and the pre-check's Node runtime with the indexer's compiled
# packages as real directories (package.json and dist/), not links. POSIX sh, so it runs inside the node:slim build
# image as well as on the owner's machine.
#
#   verify-app-tree.sh <tree>      <tree> holds bin/, java/, server/, web/, indexer/, box/ and VERSION
set -eu

tree="${1:?usage: verify-app-tree.sh <tree>}"
status=0

fail() {
  printf 'verify-app-tree: %s\n' "$*" >&2
  status=1
}

# The server and the Java runtime that runs it.
[ -f "${tree}/server/repohive-server.jar" ] || fail "server/repohive-server.jar is missing"
[ -f "${tree}/java/bin/java" ] || fail "java/bin/java is missing (the release carries its own Java runtime)"
[ -f "${tree}/java/release" ] || fail "java/release is missing (not a Java runtime directory)"

# The static export, with the placeholder pages the host mapping serves for every repository and job.
for f in index.html index.txt 404.html auth/sign-in.html auth/sign-up.html jobs/_.html jobs/_.txt repos/_/_.html \
  repos/_/_.txt repos/_/_/knowledge-graph.html repos/_/_/hierarchy.html; do
  [ -f "${tree}/web/${f}" ] || fail "web/${f} is missing (the static export)"
done
[ -d "${tree}/web/_next/static" ] || fail "web/_next/static is missing"

# The pre-check: node dist/precheck-cli.js, run by the server from REPOHIVE_INDEXER_DIR.
[ -f "${tree}/indexer/package.json" ] || fail "indexer/package.json is missing"
[ -f "${tree}/indexer/dist/precheck-cli.js" ] || fail "indexer/dist/precheck-cli.js is missing"
for p in shared parser core engine views; do
  dir="${tree}/indexer/node_modules/@repohive/${p}"
  if [ -L "${dir}" ]; then
    fail "@repohive/${p} is a link, not a copy"
  elif [ ! -d "${dir}" ]; then
    fail "@repohive/${p} is missing from indexer/node_modules"
  else
    [ -f "${dir}/package.json" ] || fail "@repohive/${p} has no package.json"
    [ -d "${dir}/dist" ] || fail "@repohive/${p} has no dist/"
  fi
done
[ ! -e "${tree}/indexer/node_modules/@repohive/indexer" ] || fail "indexer/node_modules holds a link to the indexer itself"

for f in bin/node bin/caddy box/Caddyfile box/spa.caddy box/amazon-cloudwatch-agent.json box/logrotate-repohive \
  box/bin/repohive-env box/bin/repohive-first-boot box/bin/repohive-activate box/bin/repohive-heartbeat \
  box/systemd/repohive-heartbeat.timer VERSION; do
  [ -f "${tree}/${f}" ] || fail "${f} is missing"
done
for u in repohive-env caddy repohive-server repohive-heartbeat; do
  [ -f "${tree}/box/systemd/${u}.service" ] || fail "box/systemd/${u}.service is missing"
done
# The Node viewer server and background worker are gone; a unit for either would start something that is not there.
for u in repohive-web repohive-worker; do
  [ ! -e "${tree}/box/systemd/${u}.service" ] || fail "box/systemd/${u}.service is still there (it was replaced)"
done

if [ "${status}" -eq 0 ]; then
  printf 'verify-app-tree: ok\n'
fi
exit "${status}"
