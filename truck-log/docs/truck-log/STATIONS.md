# Stations

Every browser that uses Truck Log is a **station**: a guard PC, a dock handheld (Honeywell CK65), a management PC, or a TV. A browser becomes a station once, with a pairing code from an administrator. After that it stays signed in (for up to 400 days, the browser limit) without anyone typing a password.

The station's type is its **role**. It decides which screens the browser shows, and the server enforces the same limits on every request, so typing another page's address doesn't get around them.

| Type (role) | Screens | Can change |
|---|---|---|
| **Guard station** | Guard Dashboard, Check In Truck, Dock Board, Active Trucks, Records & Paperwork, RXO, RXO Expedite, TV boards | Everything on the guard screens: check in, dock work, uploads, Final Checkout. |
| **Dock handheld** (CK65) | Dock Board, Records & Paperwork | Dock Complete (send the driver to the guard), delivery numbers, packing slips (scan, find, upload), adding paperwork. Nothing else: no check-in, Final Checkout, slips or print jobs. Other requests are refused with "This dock handheld can only use the Dock Board and Records & Paperwork." |
| **Management** | Every screen except Check In Truck | Nothing; view only. Changes are refused with "This is a view-only management station." |
| **TV display** | TV boards | Nothing; read only. Changes are refused with "This is a display-only station." |
| **Administrator** | Everything | Everything. |

An administrator signed in at `/admin/login` can use every screen without pairing their browser. Signing in as administrator on any paired station (other than a TV) lifts that station's limits until the administrator signs out.

## Dock handhelds (CK65)

Pair each CK65 as a **Dock handheld**. It opens on the Dock Board, with two large tabs under the top bar: **Dock Board** and **Records & Paperwork**. The layout is built for the CK65's small portrait screen:

- **Dock Board:** search and the two filters fit at the top. The *aging* and *overdue* counts filter the cards. Each card has Scan Document, Find PDF, Upload PDF and **Dock Complete — Send to Guard**.
- **Records & Paperwork:** the list shows load, dock, status and Open. The open record shows its details two across, with **Add Paperwork**. Guard-only actions (Print Slip, Reprint) are not shown.

## Add a station

1. On any PC, sign in as administrator and open **Admin → Stations**.
2. Choose **Add station**, give it a name people will recognise (for example `Guard Shack East`, `Dock CK65 3` or `Dock 41 TV`) and pick its type: Guard station, Dock handheld, Management or TV display.
3. Truck Log shows an 8-character code such as `K7QM-4XTD`. The code works once and expires after 30 minutes.
4. On the station itself, open `http://<truck-log-host>:4300/station/setup` and enter the code. Case, spaces and the dash don't matter. The station then opens on its own start screen: TVs on the Dockworker TV, dock handhelds on the Dock Board, everything else on the Guard Dashboard.

To change a station's type, revoke it and add it again with the new type.

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
- What each type may call is one table in `station-roles.ts` (server). Dock handhelds have an explicit allowlist and everything else is refused (`403 STATION_ROLE`); management and TV stations may only read (`403 STATION_READ_ONLY`). The web app mirrors it in `libs/truck-log/web/auth/station/src/lib/station-roles.ts`: the navigation, a route guard that sends a browser to its own start screen, and hidden buttons for actions the role can't use. `tools/truck-log/test-station-access-contract.mjs` runs the server table against allowed and refused requests for every type.
- Station types are stored in `truck_log_stations.kind` (`GUARD`, `DOCK`, `MANAGEMENT`, `DISPLAY`; migration `0006_station_roles.sql`).
- Routes that do not need a station: health checks, administrator sign-in, pairing itself, and machine routes that have their own tokens (Print Agent, scoped access credentials). `tools/truck-log/test-station-access-contract.mjs` fails if any other route is opened up.
