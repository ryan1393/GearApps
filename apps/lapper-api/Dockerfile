# Build context: repository root.  docker build -f apps/lapper-api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --ignore-scripts
COPY . .
RUN npx nx build lapper-api --configuration=production

FROM node:22-alpine AS deps
WORKDIR /app
# Nx emits a pruned package.json next to the bundle; install only runtime deps (+ native DB drivers).
COPY --from=build /app/dist/apps/lapper-api/package*.json ./
RUN apk add --no-cache python3 make g++ \
 && npm install --omit=dev \
 && apk del python3 make g++

FROM node:22-alpine
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3333
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/lapper-api ./
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD wget -qO- http://localhost:3333/api/v1/health || exit 1
CMD ["dumb-init", "node", "main.js"]
