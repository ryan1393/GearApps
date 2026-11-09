# Stations

Every browser that uses the guard screens is a **station**: a guard PC, a dock PC, or a TV. A browser becomes a station once, with a pairing code from an administrator. After that it stays signed in (for up to 400 days, the browser limit) without anyone typing a password.

| Type | Can do |
|---|---|
| **Guard station** | Everything on the guard screens: check in, dock board, uploads, checkout, records. |
| **TV display** | Read only. Any change is refused with "This is a display-only station." |

An administrator signed in at `/admin/login` can use every screen without pairing their browser.

## Add a station

1. On any PC, sign in as administrator and open **Admin → Stations**.
2. Choose **Add station**, give it a name people will recognise (for example `Guard Shack East` or `Dock 41 TV`) and pick its type.
3. Truck Log shows an 8-character code such as `K7QM-4XTD`. The code works once and expires after 30 minutes.
4. On the station itself, open `http://<truck-log-host>:4300/station/setup` and enter the code. Case, spaces and the dash don't matter.

The station name is recorded in visit history for check-ins, dock-complete, uploads and checkouts.

## Replace or remove a station

- **New pairing code** signs that station out immediately and issues a fresh code. Use it when a PC is rebuilt, its browser data is cleared, or the station moves.
- **Revoke** signs the station out for good. The name can then be reused.

## When something goes wrong

- *"This browser is not a registered Truck Log station"*: the browser was never paired, its cookies were cleared, or the station was revoked or re-issued. Pair it again with a new code.
- *"That code is wrong or has expired"*: codes last 30 minutes and work once. Issue a new one.
- *"Too many pairing attempts"*: wait five minutes.

## How it works

- Pairing codes and station tokens are stored only as SHA-256 digests (`truck_log_stations`); every create, pair, re-issue, revoke and sign-out is logged in `truck_log_station_events`.
- The station token is an HttpOnly, SameSite=Strict cookie (`TruckLogStation`, or `__Host-TruckLogStation` over HTTPS). Scripts in the page cannot read it.
- A global API guard (`libs/truck-log/server/auth/station`) checks every request. Requests that change data must also come from a configured Truck Log address (`TRUCK_LOG_PUBLIC_ORIGIN` / `TRUCK_LOG_CORS_ORIGINS`).
- Routes that do not need a station: health checks, administrator sign-in, pairing itself, and machine routes that have their own tokens (Print Agent, scoped access credentials). `tools/truck-log/test-station-access-contract.mjs` fails if any other route is opened up.
