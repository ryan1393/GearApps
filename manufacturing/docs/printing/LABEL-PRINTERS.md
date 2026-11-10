# Label printers

Gear Apps prints two kinds of label straight to network label printers:

| Label | Stock | Printed from |
| --- | --- | --- |
| Tray, container and location tags | 2.125 x 0.625 in | every **Print Tag** button |
| Cutter Build card | 4 x 6.5 in | **Print Cutter Card** on Build Cutter and Build Lookup |

Coater packing slips (Letter) and coater container labels (4 x 6) are ordinary browser prints and use whatever printer the browser offers.

## Set up a printer

Admin > **Label Printers** > *Add a printer*:

- **Name** — what operators will see, for example `Cutter Grind Zebra`.
- **IP address** and **Port** — raw printing is port 9100 on most printers.
- **Printer language** — `IPL` for Intermec / Honeywell, `ZPL` for Zebra. A printer sent the wrong language accepts the job and prints nothing.
- **Loaded with** — tags or cutter cards. Tags are never sent to a card printer, or cards to a tag printer.
- **Default** — the printer every Print button uses for that label. The first printer added for a label becomes its default; *Make Default* changes it.

The printer must be on the network and reachable **from the Gear Apps server** (the API container), not just from the operator's PC. A printer attached to one PC by USB cannot be used.

## Check a printer

- **Test Connection** opens a connection from the server and reports what to check if it fails (no answer, connection refused, name not found, no route). Nothing is printed.
- **Print Test Tag** (tag printers) prints a tag reading `TEST`. If the connection works but nothing prints, switch the printer between IPL and ZPL.

## If the label is off-centre or cut off

Each printer has **Move right (dots)** and **Move down (dots)** in its *Edit* form. They move everything that printer prints: tags and cutter cards, IPL and ZPL. 8 dots are about 1 mm (203 dots per inch); a negative number moves left or up. Save, then **Print Test Tag** and repeat until the tag sits squarely.

Before adjusting a Zebra that prints far off the label, run its media calibration first; the adjustment is for the last millimetre or two, not for a printer that has lost track of the gap.

## Choosing a printer at a workstation

Every screen with a Print Tag or Print Cutter Card button shows **Print tags to** / **Print cards to**. It starts on the default. A workstation next to its own printer can choose it there; the choice is remembered in that browser and used by every print button for that label. If the chosen printer is later removed or turned off, the workstation goes back to the default.

## When nothing prints

| What the notice says | Meaning |
| --- | --- |
| No tag / cutter card printer is set up | Add one in Admin > Label Printers. The label file is downloaded instead. |
| No answer from address within N seconds | Wrong address, printer off, or the server cannot reach that network. |
| Refused the connection on port N | Wrong port, or raw printing is switched off on the printer. |
| The name could not be found | Use the IP address. |
| Sent, but no label came out | Wrong language for that printer, or it is out of labels / paused. |

## Label languages

Tags and cards are generated in the language of the printer they are sent to. The cutter card in IPL is the supplied `CutterLabel_FILLED.prn` template; the ZPL card is the same card rebuilt element for element. Tag layout is described in [ASSET-TAG-IPL.md](ASSET-TAG-IPL.md).

What has been confirmed on a real printer: a Zebra printed the ZPL tag at the right scale with a readable barcode and text, which is what the current position allowance was measured from. Not yet confirmed on a printer: the re-centred ZPL tag layout, the ZPL cutter card, and the corrected IPL tag layout. Check the first label of each kind.

## Storage

Printers are kept in `public.gear_label_printers`, created at API startup if missing. `GEAR_LABEL_PRINTER_HOST` / `_PORT` / `_LANGUAGE` in `.env` remain as the fallback tag printer until a default tag printer is chosen here.
