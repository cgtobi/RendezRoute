# syntax=docker/dockerfile:1
# RendezRoute image (spec 2 packaging, 3.11): amd64 + arm64, non-root, works with a read-only root
# filesystem; only /data and the key directory are written. The base image is pinned by digest;
# update it deliberately (and with it the Node version in .node-version).
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

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY package.json LICENSE ./
# /keys is only created, not declared as a volume: an anonymous volume would silently hold the
# encryption key and be lost with the container. Mount a named volume there (spec 3.11).
RUN mkdir -p /data /keys && chown node:node /data /keys
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve"]
