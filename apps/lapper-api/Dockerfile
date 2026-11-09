# Build context: repository root.  docker build -f apps/lapper-api/Dockerfile .
FROM node:24.22.1-alpine AS build
WORKDIR /app
ENV HUSKY=0 CYPRESS_INSTALL_BINARY=0 NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_NO_CLOUD=true
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm install -g npm@11.9.0
RUN npm ci --ignore-scripts
COPY . .
RUN npx nx build lapper-api --configuration=production

FROM node:24.22.1-alpine AS deps
WORKDIR /app
# Nx emits a pruned package.json next to the bundle; install only runtime deps (+ native DB drivers).
COPY --from=build /app/dist/apps/lapper-api/package*.json ./
RUN npm install -g npm@11.9.0
RUN apk add --no-cache python3 make g++ \
 && npm ci --omit=dev \
 && apk del python3 make g++

FROM node:24.22.1-alpine
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3333
WORKDIR /app
COPY --from=deps /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/lapper-api ./
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD wget -qO- http://localhost:3333/api/v1/health || exit 1
CMD ["dumb-init", "node", "main.js"]
