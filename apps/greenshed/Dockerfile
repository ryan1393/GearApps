# Build context: repository root.
FROM node:24.22.1-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
ENV HUSKY=0 CYPRESS_INSTALL_BINARY=0 NX_DAEMON=false NX_ISOLATE_PLUGINS=false NX_NO_CLOUD=true
ARG BUILD_NATIVE_MODULES_FROM_SOURCE=false
RUN npm install -g npm@11.9.0
RUN npm_config_build_from_source="$BUILD_NATIVE_MODULES_FROM_SOURCE" npm ci
COPY . .
RUN npx nx build greenshed --configuration=production

FROM nginx:1.27-alpine AS runtime
COPY apps/greenshed/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/apps/greenshed/browser /usr/share/nginx/html
# Extracted source archives may have restrictive file permissions.
RUN chmod -R a+rX /usr/share/nginx/html
EXPOSE 80
