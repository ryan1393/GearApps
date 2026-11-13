# Check-In RXO Freight On The Move Load Selection

The check-in workflow includes a load-number picker to Guard Check-In sourced from the current RXO **Freight On The Move** dataset.

- Value stored as Load Number: RXO `shipment_id`.
- Source: current-visible Fort Wayne Freight On The Move rows through `GET /api/v1/rxo/data?kind=freight`.
- Selection applies RXO direction and replaces load-owned carrier, trailer, origin and destination details with the selected load values.
- Scheduled-load lookup still runs after selection.
- Manual entry remains available and is the fallback if RXO data cannot be loaded.
- RXO unavailability never blocks guard check-in.

This does not change RXO acquisition/filtering behavior or require a new backend endpoint.

## Printing at check-in

The **Printing** selector defaults to **Automatic gate printing** when the server has a configured print agent and this browser has an East/West gate saved. A saved visit then queues the Dock Assignment Slip and available RXO document for that gate. Print status describes submission to the printer; inspect the physical output when a job needs attention.

**Print manually in browser** is available without a print agent or a saved gate, including for an RXO or Expedite load. It is selected automatically when automatic setup cannot be verified. The visit keeps its RXO identity and paperwork association, but this explicit choice queues no automatic print job, including when paperwork arrives later. After saving, select **Open / Print Slip**. Open RXO paperwork from **Records & Paperwork** with authorized Materials access.

During a save or paperwork retry, check-in fields and file selection/removal are disabled. Only files acknowledged by the server are considered uploaded. Failed paperwork remains associated with the accepted visit for **Retry Paperwork**. A rejected subsequent check-in keeps the previous successful visit's print status and retry controls visible.

Print status requests have a 15-second timeout and use bounded retry polling. If status does not advance for three minutes, the page asks the guard to inspect the printer and allows **Refresh Print Status** to restart checks.

For a queued item that no agent has ever leased, **Cancel queued print** and **Replace queued print** provide audited recovery. Enter a reason; a replacement also requires East or West and uses that gate's current saved printer. Replacement creates a separate job; it does not change an existing job's frozen printer. Cancellation prevents later automatic printing of that item. A leased or previously leased job cannot use this recovery: inspect its physical outcome before a failed-item retry. The server checks eligibility again when the action is submitted. If a replacement response was lost, refresh the original package and select **Track replacement** to follow its recorded replacement job.
