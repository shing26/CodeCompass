# syntax=docker/dockerfile:1
# CodeCompass — single-process full-stack image.
# Multi-stage: builds the SPA + the control-plane bundle, then keeps only the
# runtime pieces (prod node_modules pruned, dist, web dist).

FROM node:20-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 is a native module; give npm the toolchain in case a prebuilt
# binary is not available for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Frontend
COPY apps/repoqa-web/package.json apps/repoqa-web/package-lock.json apps/repoqa-web/
RUN cd apps/repoqa-web && npm ci
COPY apps/repoqa-web/ apps/repoqa-web/
RUN cd apps/repoqa-web && npm run build

# Backend (contracts/bridge-adapters are imported from source and bundled in)
COPY services/control-plane/package.json services/control-plane/package-lock.json services/control-plane/
RUN cd services/control-plane && npm ci
COPY services/control-plane/ services/control-plane/
RUN cd services/control-plane && npm run build \
  && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/services/control-plane/dist ./services/control-plane/dist
COPY --from=build /app/services/control-plane/node_modules ./services/control-plane/node_modules
COPY --from=build /app/apps/repoqa-web/dist ./apps/repoqa-web/dist

ENV MHW_STATIC_DIR=/app/apps/repoqa-web/dist
ENV MHW_DATA_DIR=/data
EXPOSE 43110
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:43110/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "services/control-plane/dist/cli.js"]