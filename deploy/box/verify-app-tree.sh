#!/bin/sh
# Checks an assembled release tree: the standalone
# server and the workspace packages the server loads at run time must be there as real directories with their
# package.json and dist/, because next.config.ts leaves them out of the bundle. POSIX sh, so it runs inside the
# node:slim build image as well as on the owner's machine.
#
#   verify-app-tree.sh <tree>      <tree> holds app/, bin/, box/ and VERSION
set -eu

tree="${1:?usage: verify-app-tree.sh <tree>}"
status=0

fail() {
  printf 'verify-app-tree: %s\n' "$*" >&2
  status=1
}

[ -f "${tree}/app/packages/web/server.js" ] || fail "app/packages/web/server.js is missing (the standalone output)"
[ -d "${tree}/app/packages/web/.next/static" ] || fail "app/packages/web/.next/static is missing"
[ -f "${tree}/app/packages/web/scripts/run-worker.mjs" ] || fail "the worker script is missing"
[ -f "${tree}/app/packages/web/scripts/register-aliases.mjs" ] || fail "the alias loader is missing"
[ -f "${tree}/app/packages/web/src/lib/hosting/config.ts" ] || fail "packages/web/src is missing"

# The two packages next.config.ts loads at run time, plus what they import: shared, parser, core, views.
for p in indexer engine shared parser core views; do
  dir="${tree}/app/node_modules/@repohive/${p}"
  if [ -L "${dir}" ]; then
    fail "@repohive/${p} is a link, not a copy"
  elif [ ! -d "${dir}" ]; then
    fail "@repohive/${p} is missing from app/node_modules"
  else
    [ -f "${dir}/package.json" ] || fail "@repohive/${p} has no package.json"
    [ -d "${dir}/dist" ] || fail "@repohive/${p} has no dist/"
  fi
done

[ -f "${tree}/app/node_modules/next/package.json" ] || fail "next is missing from app/node_modules"
for f in bin/node bin/caddy box/Caddyfile box/amazon-cloudwatch-agent.json box/logrotate-repohive \
  box/bin/repohive-env box/bin/repohive-first-boot box/bin/repohive-activate VERSION; do
  [ -f "${tree}/${f}" ] || fail "${f} is missing"
done
for u in repohive-env caddy repohive-web repohive-worker; do
  [ -f "${tree}/box/systemd/${u}.service" ] || fail "box/systemd/${u}.service is missing"
done

if [ "${status}" -eq 0 ]; then
  printf 'verify-app-tree: ok\n'
fi
exit "${status}"
