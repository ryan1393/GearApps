# Gear Apps native asset tags (IPL)

Gear Apps asset tags use Intermec Printer Language (IPL), matching the printer-native language of the existing Cutter Build label reference.

## Database-backed encoded value

The printer does **not** accept a serial number supplied by the browser. The UI sends the database record ID and the backend reloads that Tray, Container, or Location record. The exact persisted `serial_number` from that row is then used for both the Code 128 barcode and the human-readable text.

- Tray: persisted `T` serial, for example `T0001`.
- Container: persisted `C` serial, for example `C0001`.
- Location: exact persisted Gear Apps location serial, for example `GSR-1.955FC` or `CGDR-1.955FC`.

Do not add words such as `TRAY`, `T-`, `CONTAINER`, `CONT-`, descriptions, or database UUIDs to the printed barcode.

New or edited Tray/Container serials are normalized by the backend to the canonical table format:

```text
Tray      T0001, T0002, T0003, ...
Container C0001, C0002, C0003, ...
```

The printer never creates or increments a serial. It prints the serial already stored in the record.

## Label stock

The same stock is used for Tray, Container, and Location tags:

```text
Roll / web width: 2.25 in
Label width:      2.125 in
Label height:     0.625 in
Physical gap:     0.125 in above and below the label
```

The existing Cutter Build IPL coordinates indicate the Intermec 203 dpi family. At 203 dpi the label face is approximately:

```text
2.125 in x 203 = 431 dots
0.625 in x 203 = 127 dots
2.25  in x 203 = 457 dots of web
0.125 in x 203 = 25 dots of physical gap
```

The IPL asset format uses a 431-dot print width and 127-dot label height. The printer's gap sensor/media calibration handles the physical top/bottom gap and advances to the next label.

## Printer transport

The backend can send raw IPL over TCP.

Run `commands\CONFIGURE-GEAR-APPS-LABEL-PRINTER.cmd` to set these values safely, or edit the optional environment values directly:

```text
GEAR_LABEL_PRINTER_HOST=
GEAR_LABEL_PRINTER_PORT=9100
GEAR_LABEL_PRINTER_TIMEOUT_MS=5000
```

When `GEAR_LABEL_PRINTER_HOST` is blank, Gear Apps still generates the native `.prn` payload. The browser downloads the `.prn` file instead of pretending the tag was printed.

If the host is configured but the printer cannot be reached, the API returns the same `.prn` payload as a fallback.

Every **Print Tag** button reports one of three outcomes in a notice that stays on screen wherever the list is scrolled:

- **Tag sent to printer** — the printer accepted the tag.
- **Label printer did not respond** (warning) — the tag was not printed; the `.prn` file is downloaded as a backup.
- **Tag file downloaded** — no printer is set up, so the `.prn` file is downloaded.

A failed or downloaded tag is never reported as printed.

## Barcode

The IPL format uses `c6`, matching the Cutter Build label reference and producing Code 128.

The current asset-tag format uses reserved IPL format number `97`. It does not erase all printer formats.

Serials of up to 8 characters print with a two-dot narrow bar; longer serials use a one-dot narrow bar. A serial longer than 32 characters cannot fit on the 2.125 in label, so the print request is refused with a message instead of printing a barcode that runs off the label.

## Admin printing

The shared Gear Apps `/admin` screen includes Tray, Container, and Location record lists. Each active record has its own **Print Tag** button. The print request carries the row's UUID only; the backend reloads the row and prints the table's stored serial.

