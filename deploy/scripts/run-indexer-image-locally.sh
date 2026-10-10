#!/usr/bin/env bash
# Runs the built indexer image locally, once in each mode, on the sample-java-project tarball. Does not call AWS.
#
#   deploy/scripts/run-indexer-image-locally.sh [cli|lambda|fargate|all] [tag]
#
# Modes:
#   cli      the whole job inside the image on the sample tarball: the local fetcher, a mounted directory as the
#            store (REPOHIVE_STORE=local:<dir> semantics, via --store) and a memory reporter. This is the run that
#            proves the image holds a working job (WebAssembly grammars resolved from node_modules, and so on).
#   lambda   the image's default command (the Lambda handler) under the base image's runtime interface emulator,
#            invoked with an event that is not a job input: the handler must load and answer with a job-input error.
#   fargate  the Fargate entry point (entryPoint node, command dist/fargate.js, as DEPLOY.md and the task
#            definition set it) with REPOHIVE_JOB_INPUT unset: it must load and exit 1 naming the variable.
#
# Why lambda and fargate do not run the sample job: both entry points build the GitHub source fetcher
# (src/entry.ts), and nothing selects the local fetcher from the environment, so a job through them would call
# api.github.com. That needs a package change this spec does not allow; it is recorded in the progress file.
# The store and server settings used here are the ones the task definition uses, with local values.
set -euo pipefail

# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

mode="${1:-all}"
tag="${2:-$(image_tag)}"
image="${LOCAL_IMAGE_NAME}:${tag}"

case "${mode}" in
  cli | lambda | fargate | all) ;;
  *) die "usage: run-indexer-image-locally.sh [cli|lambda|fargate|all] [tag]" ;;
esac

require_docker
docker image inspect "${image}" >/dev/null 2>&1 || die "image ${image} not found; run build-indexer-image.sh first"

work="$(mktemp -d)"
container=""
cleanup() {
  if [[ -n "${container}" ]]; then
    docker rm -f "${container}" >/dev/null 2>&1 || true
  fi
  rm -rf "${work}"
}
trap cleanup EXIT

commit="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
repo="acme/sample-java-project"
tarball="${work}/sample-java-project.tar.gz"
git -C "${REPO_ROOT}" archive --format=tar.gz --prefix="acme-sample-java-project-${commit}/" \
  -o "${tarball}" "HEAD:fixtures/sample-java-project"
mkdir -p "${work}/store"

# A placeholder: the entry points require a token outside the local runtime, and none of these runs uses it.
placeholder_token="not-a-real-token"

run_cli() {
  printf '== cli: the job on the sample tarball\n'
  local out
  out="$(docker run --rm --platform linux/arm64 \
    -v "${work}:/data" \
    --entrypoint node \
    "${image}" dist/cli.js \
    --tarball /data/sample-java-project.tar.gz --repo "${repo}" --commit "${commit}" \
    --store /data/store)"
  printf '%s\n' "${out}"
  [[ "${out}" == *'"kind":"ran"'* && "${out}" == *'"status":"succeeded"'* ]] ||
    die "cli run did not report a succeeded job"
  [[ -n "$(find "${work}/store/artifacts" -type f -name 'manifest.json' -print -quit)" ]] ||
    die "cli run wrote no manifest.json under artifacts/ in the mounted store"
  printf 'cli: ok\n'
}

run_lambda() {
  printf '== lambda: the default handler under the runtime interface emulator\n'
  command -v curl >/dev/null 2>&1 || die "curl is required for the lambda mode"
  container="repohive-indexer-local-$$"
  docker run -d --name "${container}" --platform linux/arm64 -p 127.0.0.1:9000:8080 \
    -v "${work}:/data" \
    -e REPOHIVE_STORE=local:/data/store \
    -e REPOHIVE_SERVER_URL=http://127.0.0.1:9 \
    -e REPOHIVE_INTERNAL_SECRET=not-a-real-secret \
    -e REPOHIVE_GITHUB_TOKEN="${placeholder_token}" \
    "${image}" >/dev/null
  local reply="" attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if reply="$(curl -s --max-time 30 -XPOST 'http://127.0.0.1:9000/2015-03-31/functions/function/invocations' -d '{}')" &&
      [[ -n "${reply}" ]]; then
      break
    fi
    sleep 1
    [[ "${attempt}" -lt 10 ]] || die "the emulator did not answer"
  done
  printf '%s\n' "${reply}"
  [[ "${reply}" == *"job input"* ]] || die "the handler did not answer with a job-input error"
  docker rm -f "${container}" >/dev/null 2>&1 || true
  container=""
  printf 'lambda: ok\n'
}

run_fargate() {
  printf '== fargate: the task entry point, without a job input\n'
  local status=0 err
  err="$(docker run --rm --platform linux/arm64 \
    -v "${work}:/data" \
    --entrypoint node \
    -e REPOHIVE_RUNTIME=fargate \
    -e REPOHIVE_STORE=local:/data/store \
    -e REPOHIVE_SERVER_URL=http://127.0.0.1:9 \
    -e REPOHIVE_INTERNAL_SECRET=not-a-real-secret \
    -e REPOHIVE_GITHUB_TOKEN="${placeholder_token}" \
    -e REPOHIVE_TIME_LIMIT_MS=60000 \
    "${image}" dist/fargate.js 2>&1)" || status=$?
  printf '%s\n' "${err}"
  [[ "${status}" -eq 1 ]] || die "expected exit code 1, got ${status}"
  [[ "${err}" == *"REPOHIVE_JOB_INPUT is not set"* ]] || die "the entry point did not name REPOHIVE_JOB_INPUT"
  printf 'fargate: ok\n'
}

case "${mode}" in
  cli) run_cli ;;
  lambda) run_lambda ;;
  fargate) run_fargate ;;
  all)
    run_cli
    run_lambda
    run_fargate
    ;;
esac
