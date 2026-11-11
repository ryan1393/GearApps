# Build context: repository root.
# Every MeshForge image starts with the same lines down to "npm ci", so Docker installs the
# build dependencies once and all images reuse that layer.
FROM node:24.22.1-bookworm-slim AS manifests
WORKDIR /manifests
COPY package.json package-lock.json ./
# A release changes only the version in these two files. It is blanked here so that a release
# with unchanged dependencies reuses the installed layer instead of installing again.
RUN node -e "const fs=require('node:fs');for(const f of ['package.json','package-lock.json']){const j=JSON.parse(fs.readFileSync(f,'utf8'));j.version='0.0.0';if(j.packages&&j.packages[''])j.packages[''].version='0.0.0';fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')}"

FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
ENV HUSKY=0 CYPRESS_INSTALL_BINARY=0 NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_NO_CLOUD=true
RUN npm install -g npm@11.9.0
COPY --from=manifests /manifests/ ./
# Building compiles no native module, so install scripts (and the compiler they need) are skipped.
RUN npm ci --ignore-scripts
COPY . .
RUN npx nx build meshforge-server --configuration=production
RUN npx nx run meshforge-server:build-fresh-db-bootstrap --configuration=production
RUN node -e "const fs=require('node:fs');const p='dist/apps/server-bootstrap/main.js';if(fs.readFileSync(p,'utf8').includes('@ngneat/falso'))throw new Error('Fresh DB bootstrap must not depend on test-only falso');"

FROM node:24.22.1-bookworm-slim AS production-deps
# The running API needs its native modules (bcrypt). They normally download prebuilt; the
# compiler is here so they can be built from source when that download is blocked.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HUSKY=0
RUN npm install -g npm@11.9.0
COPY --from=manifests /manifests/ ./
ARG BUILD_NATIVE_MODULES_FROM_SOURCE=false
RUN npm_config_build_from_source="$BUILD_NATIVE_MODULES_FROM_SOURCE" npm ci --omit=dev

FROM node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-deps /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/server ./dist/apps/server
COPY --from=build /app/dist/apps/server-bootstrap ./dist/apps/server-bootstrap
COPY --from=build /app/tools/manufacturing/base-data ./tools/manufacturing/base-data
EXPOSE 3333
CMD ["node", "dist/apps/server/main.js"]
