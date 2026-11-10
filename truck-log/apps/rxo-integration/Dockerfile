# Build context: the repository root (see docker-compose.yml); Dockerfile.dockerignore
# keeps the context to this app plus libs/truck-log/rxo-shared.
FROM mcr.microsoft.com/playwright:v1.55.1-noble AS runtime

ARG TRUCK_LOG_RELEASE=1.0.4
LABEL com.dana.truck-log.release="${TRUCK_LOG_RELEASE}" \
      org.opencontainers.image.version="${TRUCK_LOG_RELEASE}" \
      com.dana.truck-log.component="rxo-export"

ENV TRUCK_LOG_RELEASE=${TRUCK_LOG_RELEASE}
WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY apps/rxo-integration/package.json apps/rxo-integration/package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY apps/rxo-integration/src ./src
# One shared implementation for both RXO workers replaces the source-tree re-export shims.
COPY libs/truck-log/rxo-shared/ ./src/lib/
RUN find src -type f -name '*.mjs' -print -exec node --check {} \;

# Local fixture pages only: no RXO login or network request during image build.
RUN node src/test-new-host-filter-readiness.mjs

RUN mkdir -p /app/data /app/state/profile

ENV RXO_DATA_DIR=/app/data \
    RXO_PROFILE_DIR=/app/state/profile \
    RXO_SYNC_INTERVAL_MINUTES=30 \
    RXO_MAX_SCAN_DURATION_MINUTES=30 \
    RXO_NO_PROGRESS_TIMEOUT_MINUTES=15 \
    RXO_RECOVERY_COOLDOWN_SECONDS=30 \
    RXO_MAX_AUTOMATIC_RECOVERY_ATTEMPTS=1 \
    RXO_SYNC_ON_START=true \
    RXO_HEADLESS=true \
    RXO_MAX_ATTEMPTS=3 \
    RXO_RETRY_DELAY_SECONDS=20

CMD ["node", "src/rxo-scheduler.mjs"]

# Optional one-time interactive login service. Not built during normal compose up.
FROM runtime AS interactive
USER root
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify x11-utils \
    && rm -rf /var/lib/apt/lists/*
COPY apps/rxo-integration/browser-bootstrap.sh /app/browser-bootstrap.sh
RUN chmod 755 /app/browser-bootstrap.sh
ENV RXO_HEADLESS=false
CMD ["/bin/sh", "/app/browser-bootstrap.sh"]
