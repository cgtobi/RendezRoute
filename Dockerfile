# syntax=docker/dockerfile:1
# RendezRoute image (spec 2 packaging, 3.11): amd64 + arm64, non-root, works with a read-only root
# filesystem; only /data and the key directory are written. The base image is pinned by digest;
# update it deliberately (and with it the Node version in .node-version). The `ha` target below is
# the Home Assistant app image; the last stage is the normal one.
#
# IMAGE_TARGET picks which stage the last stage (`final`) is: `runtime` (the default, the normal
# image) or `ha`. The official Home Assistant builder actions cannot pass `--target`, so the
# publish workflow passes `IMAGE_TARGET=ha` as a build argument instead (decision I77). An ARG
# before the first FROM is usable in FROM lines only, which is all it is needed for. Keep `final`
# the last stage: a plain `docker build .` builds it.
ARG IMAGE_TARGET=runtime
ARG NODE_IMAGE=node:26-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# What both images ship: the build output and the production dependencies, no user chosen yet.
FROM ${NODE_IMAGE} AS runtime-base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY package.json LICENSE ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# The Home Assistant app image (decision D57): `docker build --target ha`. The Supervisor runs the
# image's own USER and creates /data and /config owned by root, with /data/options.json readable by
# root only, so this image starts as root: dist/ha-start.js reads the options, hands /data and /config
# to the node user, drops privileges and serves in the same process. It adds no capabilities. The
# builder sets io.hass.version and io.hass.arch. It is deliberately not the last stage, so a plain
# `docker build .` still produces the normal image below.
FROM runtime-base AS ha
LABEL io.hass.type="app"
USER root
ENTRYPOINT ["node", "dist/ha-start.js"]
CMD []

FROM runtime-base AS runtime
# /keys is only created, not declared as a volume: an anonymous volume would silently hold the
# encryption key and be lost with the container. Mount a named volume there (spec 3.11).
RUN mkdir -p /data /keys && chown node:node /data /keys
USER node
VOLUME ["/data"]
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve"]

# The image a plain `docker build .` produces: the normal image, or the Home Assistant one when
# IMAGE_TARGET=ha. It adds nothing of its own, so it has the same layers and configuration.
FROM ${IMAGE_TARGET} AS final
