# Independent image. Do not derive from/run the standard RXO scheduler target.
# Build context: the repository root (see docker-compose.yml); Dockerfile.dockerignore
# keeps the context to this app plus libs/truck-log/rxo-shared.
FROM mcr.microsoft.com/playwright:v1.55.1-noble
ARG TRUCK_LOG_RELEASE=1.0.5
LABEL com.dana.truck-log.component="rxo-expedite" \
      com.dana.truck-log.release="${TRUCK_LOG_RELEASE}" \
      org.opencontainers.image.version="${TRUCK_LOG_RELEASE}"
ENV TRUCK_LOG_RELEASE=${TRUCK_LOG_RELEASE}
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY apps/rxo-expedite/package.json apps/rxo-expedite/package-lock.json ./
# Match the browser image and install the exact audited dependency graph.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY apps/rxo-expedite/src ./src
# One shared implementation for both RXO workers replaces the source-tree re-export shims.
COPY libs/truck-log/rxo-shared/ ./src/lib/
RUN find src -type f -name '*.mjs' -print -exec node --check {} \;
RUN mkdir -p /app/data /app/state/expedite-profile
ENTRYPOINT ["node", "/app/src/cli.mjs"]
CMD ["--help"]
