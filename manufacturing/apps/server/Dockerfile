# Build context: repository root.
FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
ENV HUSKY=0 CYPRESS_INSTALL_BINARY=0 NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_NO_CLOUD=true
RUN npm install -g npm@11.9.0
RUN npm ci
COPY . .
RUN npx nx build gear-app-server --configuration=production
RUN npx nx run gear-app-server:build-fresh-db-bootstrap --configuration=production
RUN node -e "const fs=require('node:fs');const p='dist/manufacturing/apps/server-bootstrap/main.js';if(fs.readFileSync(p,'utf8').includes('@ngneat/falso'))throw new Error('Fresh DB bootstrap must not depend on test-only falso');"

FROM node:24.22.1-bookworm-slim AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
ENV NODE_ENV=production HUSKY=0
RUN npm install -g npm@11.9.0
RUN npm ci --omit=dev

FROM node:24.22.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-deps /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/manufacturing/apps/server ./dist/manufacturing/apps/server
COPY --from=build /app/dist/manufacturing/apps/server-bootstrap ./dist/manufacturing/apps/server-bootstrap
COPY --from=build /app/manufacturing/tools/base-data ./manufacturing/tools/base-data
EXPOSE 3333
CMD ["node", "dist/manufacturing/apps/server/main.js"]
