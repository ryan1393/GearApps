# Build context: repository root.
FROM node:24.22.1-bookworm-slim AS build
# Native dependencies can fall back to node-gyp when prebuilt downloads fail.
# Build tools remain in dependency stages, outside the final runtime image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
ENV HUSKY=0 CYPRESS_INSTALL_BINARY=0 NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_NO_CLOUD=true
ARG BUILD_NATIVE_MODULES_FROM_SOURCE=false
RUN npm install -g npm@11.9.0
RUN npm_config_build_from_source="$BUILD_NATIVE_MODULES_FROM_SOURCE" npm ci
COPY . .
RUN npx nx build meshforge-server --configuration=production
RUN npx nx run meshforge-server:build-fresh-db-bootstrap --configuration=production
RUN node -e "const fs=require('node:fs');const p='dist/apps/server-bootstrap/main.js';if(fs.readFileSync(p,'utf8').includes('@ngneat/falso'))throw new Error('Fresh DB bootstrap must not depend on test-only falso');"

FROM node:24.22.1-bookworm-slim AS production-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
ENV NODE_ENV=production HUSKY=0
ARG BUILD_NATIVE_MODULES_FROM_SOURCE=false
RUN npm install -g npm@11.9.0
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
