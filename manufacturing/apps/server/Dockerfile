FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY vendor/dana-ui/package ./vendor/dana-ui/package
ENV HUSKY=0
RUN npm install -g npm@11.6.2
RUN npm ci

COPY . .
RUN npx nx build gear-app-server --configuration=production
RUN npx nx run gear-app-server:build-fresh-db-bootstrap --configuration=production
RUN node -e "const fs=require('node:fs');const p='dist/apps/server-bootstrap/main.js';const s=fs.readFileSync(p,'utf8');if(s.includes('@ngneat/falso')){throw new Error('Fresh DB bootstrap bundle contains dev-only @ngneat/falso runtime dependency')};console.log('[PASS] Fresh DB bootstrap bundle contains no @ngneat/falso dependency')"

FROM node:24-bookworm-slim AS production-deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY vendor/dana-ui/package ./vendor/dana-ui/package
ENV NODE_ENV=production
ENV HUSKY=0
RUN npm install -g npm@11.6.2
RUN npm pkg delete scripts.prepare && npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/server ./dist/apps/server
COPY --from=build /app/dist/apps/server-bootstrap ./dist/apps/server-bootstrap
COPY --from=build /app/tools/base-data ./tools/base-data

EXPOSE 3333
CMD ["node", "dist/apps/server/main.js"]
