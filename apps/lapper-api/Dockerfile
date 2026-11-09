# Build context: repository root.  docker build -f apps/lapper-api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --ignore-scripts
COPY . .
RUN npx nx build lapper-api --configuration=production \
 && node tools/docker/add-db-drivers.cjs package.json dist/apps/lapper-api/package.json

FROM node:22-alpine AS deps
WORKDIR /app
COPY --from=build /app/dist/apps/lapper-api/package.json ./
# better-sqlite3 / bcrypt are native modules; build tools are needed only here.
RUN apk add --no-cache python3 make g++ \
 && npm install --omit=dev --no-audit --no-fund

FROM node:22-alpine
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3333
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/lapper-api ./
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3333/api/v1/health || exit 1
CMD ["dumb-init", "node", "main.js"]
