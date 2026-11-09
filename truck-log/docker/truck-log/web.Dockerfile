FROM node:22-bookworm-slim AS build
ARG TRUCK_LOG_RELEASE=1.0.3
ENV TRUCK_LOG_RELEASE=${TRUCK_LOG_RELEASE}
WORKDIR /app
ENV NX_DAEMON=false NX_SKIP_NX_CACHE=true
ENV npm_config_cache=/tmp/npm-cache
COPY package.json package-lock.json ./
# @dana/ui (shared Dana styling) is installed from this vendored package.
COPY vendor ./vendor
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY . .
RUN node tests/new-host/test-build-inputs.mjs
# Release-package hygiene is validated on the source archive before npm ci.
# npm ci intentionally creates node_modules in this build stage.
RUN node ./node_modules/nx/dist/bin/nx.js build truck-log --configuration=production --skip-nx-cache

FROM nginx:1.27-alpine
ARG TRUCK_LOG_RELEASE=1.0.3
LABEL com.dana.truck-log.release="${TRUCK_LOG_RELEASE}" \
      org.opencontainers.image.version="${TRUCK_LOG_RELEASE}" \
      com.dana.truck-log.component="truck-log-web"
COPY docker/truck-log/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/truck-log/nginx.https.conf.template docker/truck-log/start-https.sh /opt/truck-log/
COPY --from=build /app/dist/apps/truck-log/browser /usr/share/nginx/html
EXPOSE 80
EXPOSE 443
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 CMD wget -Y off -q -O /dev/null http://127.0.0.1/ || exit 1
