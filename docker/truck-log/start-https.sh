#!/bin/sh
set -eu

# Restrict the only substituted value to the server's proxy-key format. Nginx
# variables such as $remote_addr must survive expansion unchanged.
case "${TRUCK_LOG_ADMIN_PROXY_KEY:-}" in
  ''|*[!0-9a-f]*) echo 'HTTPS proxy key must be 64 lowercase hexadecimal characters.' >&2; exit 1 ;;
esac
[ "${#TRUCK_LOG_ADMIN_PROXY_KEY}" -eq 64 ] || { echo 'HTTPS proxy key must be 64 lowercase hexadecimal characters.' >&2; exit 1; }
for cert_file in fullchain.pem privkey.pem; do
  [ -r "/etc/nginx/truck-log-tls/$cert_file" ] || { echo "Missing readable TLS file: $cert_file" >&2; exit 1; }
done
envsubst '${TRUCK_LOG_ADMIN_PROXY_KEY}' < /opt/truck-log/nginx.https.conf.template > /etc/nginx/conf.d/default.conf
[ "${1:-}" != '--check' ] || exec nginx -t
exec nginx -g 'daemon off;'
