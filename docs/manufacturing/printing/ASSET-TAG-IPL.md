# MeshForge native asset tags (IPL)

MeshForge asset tags are sent to the printer in its own language: Intermec Printer Language (IPL), matching the existing Cutter Build label reference, or Zebra ZPL. Which one is set per printer in Admin > Label Printers.

## Database-backed encoded value

The printer does **not** accept a serial number supplied by the browser. The UI sends the database record ID and the backend reloads that Tray, Container, or Location record. The exact persisted `serial_number` from that row is then used for both the Code 128 barcode and the human-readable text.

- Tray: persisted `T` serial, for example `T0001`.
- Container: persisted `C` serial, for example `C0001`.
- Location: exact persisted MeshForge location serial, for example `GSR-1.955FC` or `CGDR-1.955FC`.

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

## Printers

Printers are set up in **Admin > Label Printers**; see [LABEL-PRINTERS.md](LABEL-PRINTERS.md). Each printer has a network address, a language (IPL for Intermec / Honeywell, ZPL for Zebra) and what it is loaded with. The tag is generated in the language of the printer it is sent to, and sent as raw bytes over TCP.

`GEAR_LABEL_PRINTER_HOST`, `GEAR_LABEL_PRINTER_PORT` and `GEAR_LABEL_PRINTER_LANGUAGE` are only the fallback tag printer, used until a default tag printer is chosen in Admin. `GEAR_LABEL_PRINTER_TIMEOUT_MS` is how long any printer is given to answer.

Every **Print Tag** button reports one of three outcomes in a notice that stays on screen wherever the list is scrolled:

- **Tag sent to printer** — the named printer accepted the tag.
- **<printer> did not print** (warning) — the tag was not printed; the notice says what to check, and the tag file is downloaded as a backup.
- **Tag file downloaded** — no tag printer is set up, so the tag file is downloaded.

A failed or downloaded tag is never reported as printed. A printer accepting the bytes does not prove a label came out: a printer sent the wrong language accepts the job and prints nothing.

## Layout

Both languages produce the same tag: a Code 128 barcode of the stored serial, centred, with the serial as text centred under it, read across the 2.125 in web. Barcode and text together are 86 dots tall on the 127-dot label, so the tag stays on the label when a printer starts a couple of millimetres early or late.

| Serial length | Narrow bar | Example |
| --- | --- | --- |
| up to 6 | 3 dots | `T0001`, `C0001` |
| 7 to 12 | 2 dots | `CGDR-1.955FC` |
| 13 to 30 | 1 dot | long location serials |

A serial longer than 30 characters cannot keep its quiet zones on the label, so the print request is refused with a message instead of printing a barcode that runs off the label.

Where the tag lands can be nudged per printer with **Move right** / **Move down** in Admin > Label Printers; see [LABEL-PRINTERS.md](LABEL-PRINTERS.md).

### IPL

The format uses `c6` (Code 128), as the Cutter Build card does, and reserved format number `97`. It does not erase the printer's other formats.

In IPL the first origin value runs **along the feed** and the second **across the web**, and a direction-0 field reads along the feed. Fields that read across the web are direction 3 with their top edge at the larger feed value. This is how the Cutter Build card is laid out (its barcode is `o82,59;f3` on a 1320-dot-long card), and the tag follows it: a field meant to sit N dots below the top of the tag has its origin at `127 - N`.

Earlier versions wrote the tag fields as direction 0, which lays the barcode along the 0.625 in feed length where it does not fit, and included a stray `L127;` line field. Both are corrected. **This corrected layout has not yet been confirmed on a printer**; use *Print Test Tag* in Admin > Label Printers and check the first tag.

### ZPL

`^FO` is across the web, then down the feed. The barcode is `^BC` Code 128 in subset B, so its width is known and it can be centred; the text is font 0 centred with `^FB`. `^PW431` sets the print width. No label length is sent: on gap stock the printer's own media calibration knows where each label starts.

The first tags printed on a Zebra from the earlier layout landed about 20 dots (2.5 mm) above and 23 dots (2.9 mm) left of where the format placed them, with the top of the barcode in the gap before the label. ZPL tags are therefore positioned 23 dots right and 20 dots down in printer coordinates (`ZPL_REGISTRATION` in `asset-tag-label.ts`). A Zebra that registers differently is corrected with its own adjustment.

Reference output for both languages is in [samples](samples); the unit tests compare generated tags with those files byte for byte.

## Admin printing

The shared MeshForge `/admin` screen includes Tray, Container, and Location record lists. Each active record has its own **Print Tag** button. The print request carries the row's UUID only; the backend reloads the row and prints the table's stored serial.

