FROM node:22-bookworm-slim AS build
ARG TRUCK_LOG_RELEASE=1.0.9
ENV TRUCK_LOG_RELEASE=${TRUCK_LOG_RELEASE}
WORKDIR /app
ENV NX_DAEMON=false NX_SKIP_NX_CACHE=true
COPY package.json package-lock.json ./
# @dana/ui (shared Dana styling) is installed from this vendored package.
COPY vendor ./vendor
RUN npm ci --no-audit --no-fund
COPY . .
RUN node tests/new-host/test-build-inputs.mjs
RUN node tests/new-host/test-core.mjs
RUN node tests/new-host/test-migrations.mjs
# Release-package hygiene is validated on the source archive before npm ci.
# npm ci intentionally creates node_modules in this build stage.
RUN node ./node_modules/nx/dist/bin/nx.js build truck-log-server --skip-nx-cache

FROM node:22-bookworm-slim
ARG TRUCK_LOG_RELEASE=1.0.9
LABEL com.dana.truck-log.release="${TRUCK_LOG_RELEASE}" \
      org.opencontainers.image.version="${TRUCK_LOG_RELEASE}" \
      com.dana.truck-log.component="truck-log-server"
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends docker.io ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# @dana/ui (shared Dana styling) is installed from this vendored package.
COPY vendor ./vendor
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist/apps/truck-log-server ./dist/apps/truck-log-server
# Database migrations and the operator utilities that run inside this container
# (admin accounts, access/print-agent credentials, reference CSV import, mock data).
COPY database/truck-log/migrations ./database/truck-log/migrations
COPY tools/truck-log/migrate.mjs tools/truck-log/database-tooling.mjs tools/truck-log/env.mjs ./tools/truck-log/
COPY tools/truck-log/admin-accounts.cjs tools/truck-log/admin-auth-core.cjs ./tools/truck-log/
COPY tools/truck-log/provision-access-credential.mjs tools/truck-log/provision-print-agent.mjs ./tools/truck-log/
COPY tools/truck-log/mock-data.mjs tools/truck-log/sap-document-reset-safety.mjs ./tools/truck-log/
COPY tools/truck-log/reference-csv ./tools/truck-log/reference-csv
COPY tools/truck-log/rxo/verify-local-rxo-latest.mjs ./tools/truck-log/rxo/verify-local-rxo-latest.mjs
# Lets the RXO Control Center confirm the running exporter matches this release.
COPY apps/rxo-integration/RUNTIME-MANIFEST.json ./apps/rxo-integration/RUNTIME-MANIFEST.json
COPY docker/truck-log/server-entrypoint.sh ./docker/truck-log/server-entrypoint.sh
RUN chmod 755 ./docker/truck-log/server-entrypoint.sh
EXPOSE 3334
ENTRYPOINT ["./docker/truck-log/server-entrypoint.sh"]
