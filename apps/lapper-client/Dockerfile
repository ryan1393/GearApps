# Build context: repository root.  docker build -f apps/lapper-client/Dockerfile .
FROM node:24.22.1-alpine AS build
WORKDIR /app
ENV HUSKY=0 CYPRESS_INSTALL_BINARY=0 NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_NO_CLOUD=true
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm install -g npm@11.9.0
RUN npm ci --ignore-scripts
COPY . .
RUN npx nx build lapper-client --configuration=production

FROM nginx:1.27-alpine
COPY apps/lapper-client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/apps/lapper-client/browser /usr/share/nginx/html
# Extracted source archives may have restrictive file permissions.
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://localhost/healthz || exit 1
