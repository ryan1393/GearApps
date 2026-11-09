# Build context: repository root.  docker build -f apps/lapper-client/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --ignore-scripts
COPY . .
RUN npx nx build lapper-client --configuration=production

FROM nginx:1.27-alpine
COPY apps/lapper-client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/apps/lapper-client/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://localhost/healthz || exit 1
