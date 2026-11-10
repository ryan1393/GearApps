# Build context: repository root.  docker compose --profile collectors build lapper-read
# FANUC's licensed Linux FOCAS library is NOT part of the image: mount it at /opt/fanuc.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FOCAS_LIBRARY=/opt/fanuc/libfwlib32.so \
    LAPPER_STATE_DIR=/data

# libfwlib32.so links against the C++ runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /data lapper \
    && mkdir -p /data /opt/fanuc \
    && chown lapper /data

WORKDIR /app
COPY apps/lapper-read-py/lapper_read ./lapper_read

USER lapper
VOLUME ["/data"]

# Healthy while the sampler is reading the controller (heartbeat in /data).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["python", "-m", "lapper_read", "health"]

ENTRYPOINT ["python", "-m", "lapper_read"]
CMD ["run"]
