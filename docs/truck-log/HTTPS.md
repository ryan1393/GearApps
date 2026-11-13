# HTTPS deployment

The optional `docker-compose.https.yml` overlay serves the web app and `/api/v1` over TLS. It replaces the public HTTP port, keeps the API host port on loopback by default, and authenticates Nginx to the API with both a dedicated Docker IP and a shared proxy key. HTTPS administrator and station cookies retain their Secure flag.

The base Compose deployment continues to support HTTP on port 4300. Its `internal-http` mode does not encrypt administrator passwords, station cookies, bearer tokens or paperwork. Use the HTTPS overlay for shared production networks. Setting `TRUCK_LOG_ADMIN_TRANSPORT=https` alone does not configure a TLS listener; the overlay and certificate are also required.

## Requirements

- Docker Compose **2.24.4 or newer**. The overlay uses `!override` so HTTP port 4300 is removed instead of remaining published beside TLS.
- A DNS name that resolves to the Docker host and a certificate valid for that name, issued by a CA trusted by every operator browser, TV, Print Agent and SAP watcher PC.
- A certificate directory **on the Linux Docker host**, outside the extracted source folder, containing `fullchain.pem` (server certificate and intermediates) and `privkey.pem` (unencrypted PEM key). Restrict access to the directory/key. The web container mounts it read-only; it is never built into the image.

This works with a Windows control PC using a remote Docker context. A bind mount refers to the remote Docker host's filesystem, not the Windows control PC. Copy the certificate and key to the Linux host before starting. No certificate issuance, DNS change or firewall change is performed automatically.

## Configure

Prepare a fresh installation without starting the base HTTP stack:

```sh
./SETUP-TRUCK-LOG.sh --no-start
# Windows control PC: SETUP-TRUCK-LOG.cmd -NoStart
```

Keep the generated database and signing secrets. Edit the existing `.env`, using your actual DNS name and host certificate directory:

```dotenv
TRUCK_LOG_PUBLIC_ORIGIN=https://trucklog.example.internal
TRUCK_LOG_CORS_ORIGINS=https://trucklog.example.internal
TRUCK_LOG_ADMIN_TRANSPORT=https
TRUCK_LOG_TLS_PORT=443
TRUCK_LOG_TLS_CERT_DIR=/opt/truck-log/tls
TRUCK_LOG_API_BIND_ADDRESS=127.0.0.1
TRUCK_LOG_ADMIN_PROXY_KEY=REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS
```

Generate the proxy key locally with `openssl rand -hex 32` on Linux, or `[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()` in PowerShell 7. Put the result in `.env`; do not paste it into support logs. Both services receive the same key. The startup script rejects missing or malformed keys before Nginx starts.

Port 443 is the default. For a different TLS port, include it in both origins, for example `https://trucklog.example.internal:8443`. Origins must contain no path or trailing slash.

The dedicated proxy subnet defaults to `172.30.43.0/24`, and Nginx uses `172.30.43.10`. If that subnet overlaps an existing host/VPN/Docker network, choose a free subnet and set **both** `TRUCK_LOG_TLS_PROXY_SUBNET` and `TRUCK_LOG_TLS_PROXY_IP` in `.env`. The overlay derives the API's exact trusted-IP allowlist from the same IP. Do not broaden it to a subnet or trust arbitrary forwarding headers. Nginx reaches the API through an alias on this dedicated network so its source IP is stable.

## Start and verify

Use **both files for every HTTPS lifecycle command**. The `SETUP`, `START` and other root wrappers target the base HTTP deployment; use the explicit commands below for this overlay.

Linux, from the extracted release directory:

```sh
export TRUCK_LOG_RELEASE="$(cat VERSION)"
docker compose --env-file .env -f docker-compose.yml -f docker-compose.https.yml config --quiet
docker compose --env-file .env -f docker-compose.yml -f docker-compose.https.yml up -d --build
docker compose --env-file .env -f docker-compose.yml -f docker-compose.https.yml ps
```

For Windows control PCs, pin the release first with `$env:TRUCK_LOG_RELEASE = (Get-Content VERSION -Raw).Trim()`, then run the same three `docker compose` commands from PowerShell.

Open `TRUCK_LOG_PUBLIC_ORIGIN` in a client browser and verify its certificate is trusted. Then create/sign in as the administrator and pair stations using the normal instructions. An HTTP administrator session is separate from an HTTPS session; sign in again after switching. Pair the browser at the new HTTPS origin because browser station cookies belong to that origin. Revoke obsolete HTTP station pairings when the changeover is complete.

Configure Print Agents and the SAP watcher with `https://trucklog.example.internal/api/v1`, including a custom port if used. For the base HTTP deployment, they can use `http://<docker-host>:4300/api/v1`. Remote clients should use the web/API route; direct port 3334 is now host-loopback-only by default. Install the issuing CA into each PC's appropriate trust store; do not disable certificate verification.

The web healthcheck uses a private loopback liveness listener and does not bypass TLS verification. Check the externally served certificate and API from a client as part of rollout. Nginx replaces caller-supplied forwarding headers, proxy keys and asserted client IPs. The API requires the configured peer IP and proxy key before accepting the HTTPS assertion.

## Operate, renew and upgrade

```sh
docker compose --env-file .env -f docker-compose.yml -f docker-compose.https.yml logs --tail=100 truck-log-web truck-log-server
docker compose --env-file .env -f docker-compose.yml -f docker-compose.https.yml stop
docker compose --env-file .env -f docker-compose.yml -f docker-compose.https.yml up -d
```

After renewing `fullchain.pem`/`privkey.pem` in the same host directory, run `docker compose --env-file .env -f docker-compose.yml -f docker-compose.https.yml exec truck-log-web nginx -t`, then `docker compose --env-file .env -f docker-compose.yml -f docker-compose.https.yml exec truck-log-web nginx -s reload`. Verify the new certificate from a client.

For upgrades, back up data, preserve `.env` and the host certificate directory, pin the new release from `VERSION`, and use `up -d --build` with both files again. Running the base Compose file alone can restore the HTTP listener; keep the overlay in every command. Rotating the proxy key requires recreating both `truck-log-server` and `truck-log-web` together.
