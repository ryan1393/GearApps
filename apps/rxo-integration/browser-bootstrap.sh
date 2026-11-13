#!/bin/sh
# The daemon publishes this service ONLY on 127.0.0.1. Remote access must use SSH.
# websockify listens on all container interfaces so the port can be published; the
# VNC password below keeps other containers on the truck-log network out.
set -eu
export DISPLAY=:99
Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp &
XVFB_PID=$!
cleanup() {
  kill "${APP_PID:-}" "${WEB_PID:-}" "${VNC_PID:-}" "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
n=0
until xdpyinfo -display :99 >/dev/null 2>&1; do
  n=$((n + 1)); [ "$n" -lt 40 ] || exit 1
  sleep 0.25
done
# A fresh random VNC password per container start. Only root in this container
# (i.e. `docker exec`, used by BOOTSTRAP-RXO-BROWSER) can read it; it is never
# written to a volume or a log. RFB passwords are limited to 8 characters.
umask 077
mkdir -p /run/rxo-browser
VNC_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 8)
[ "${#VNC_PASSWORD}" -eq 8 ] || exit 1
printf '%s\n' "$VNC_PASSWORD" >/run/rxo-browser/vnc-password
x11vnc -storepasswd "$VNC_PASSWORD" /run/rxo-browser/vnc-passwd >/dev/null 2>&1
VNC_PASSWORD=''
umask 022
x11vnc -display :99 -localhost -rfbport 5900 -forever -shared -rfbauth /run/rxo-browser/vnc-passwd -quiet >/tmp/x11vnc.log 2>&1 &
VNC_PID=$!
websockify --web=/usr/share/novnc 0.0.0.0:6080 127.0.0.1:5900 >/tmp/websockify.log 2>&1 &
WEB_PID=$!
node /app/src/rxo-fort-wayne-export.mjs --login-only &
APP_PID=$!
wait "$APP_PID" || echo '[WARN] RXO interactive task failed; check browser-bootstrap.json.'
# Retain status read access until the launcher cleans up this service.
wait "$WEB_PID"
