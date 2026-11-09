# Build context: repository root.
FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
ENV HUSKY=0 CYPRESS_INSTALL_BINARY=0 NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_NO_CLOUD=true
RUN npm install -g npm@11.9.0
RUN npm ci
COPY . .
RUN npx nx build cutter-builder --configuration=production

FROM nginx:1.27-alpine AS runtime
COPY manufacturing/apps/cutter-builder/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/manufacturing/apps/cutter-builder/browser /usr/share/nginx/html
# Extracted source archives may have restrictive file permissions.
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
