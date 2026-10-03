# syntax=docker/dockerfile:1
#
# The hosted indexer image: arm64 Linux on the AWS Lambda
# Node 24 base image, holding compiled dist/ and production node_modules only,
# unbundled, with no git. One image, two runtimes: it starts as the Lambda handler
# by default and as the Fargate task through the entry point in DEPLOY.md.
#
# Build from the repository root (the context is the whole workspace):
#
#   docker buildx build --platform linux/arm64 --provenance=false \
#     -f packages/indexer/Dockerfile -t repohive-indexer .
#
# --provenance=false is required: AWS Lambda rejects an image with a provenance
# attestation. Docker 25 or later with buildx is required for these base images.
#
# Not built or run when this file was written (Docker's daemon was not running);
# see packages/indexer/DEPLOY.md.

# --- build: compile everything, then install production dependencies only ---------------------
FROM --platform=linux/arm64 public.ecr.aws/docker/library/node:24-slim AS build
WORKDIR /repo

# Every workspace's package.json must be present because the lockfile names them all; only the
# indexer's dependency tree is installed. Dockerfile.dockerignore keeps the other packages' sources out.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages

RUN npm ci --workspace @repohive/indexer --include-workspace-root --ignore-scripts \
 && npm run build

# Production dependencies only, then replace the workspace symlinks with real copies of
# the compiled packages, so the final image needs no packages/ tree.
RUN npm ci --omit=dev --workspace @repohive/indexer --ignore-scripts \
 && for p in shared parser core engine views; do \
      rm -rf "node_modules/@repohive/$p" \
      && mkdir -p "node_modules/@repohive/$p" \
      && cp -r "packages/$p/package.json" "packages/$p/dist" "node_modules/@repohive/$p/"; \
    done \
 && rm -rf node_modules/@repohive/indexer

# --- runtime ------------------------------------------------------------------------------------
FROM --platform=linux/arm64 public.ecr.aws/lambda/nodejs:24
WORKDIR ${LAMBDA_TASK_ROOT}

# package.json carries "type": "module": without it dist/*.js would not load as ES modules.
COPY --from=build /repo/packages/indexer/package.json ./package.json
COPY --from=build /repo/packages/indexer/dist ./dist
COPY --from=build /repo/node_modules ./node_modules

# V8 heap: 2,400 MB on Lambda by default; the Fargate task overrides it to 13000 (DEPLOY.md).
ENV NODE_OPTIONS=--max-old-space-size=2400
ENV REPOHIVE_RUNTIME=lambda

# The Lambda handler: dist/lambda.js exports `handler`. Fargate bypasses this with its own entry point.
CMD ["dist/lambda.handler"]
