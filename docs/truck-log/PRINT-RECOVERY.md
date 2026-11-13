# Manual printing and queue recovery

Check-in lets the guard choose automatic gate printing or manual browser printing. When automatic printing is unavailable, manual mode remains available. Manual mode saves the visit and exact RXO association without queuing either document. Open the Dock Assignment slip in the browser; RXO documents remain available from Records. This choice is retained when Materials uploads paperwork later.

Automatic printing freezes the selected gate, printer and PDF. If that printer becomes unavailable before a lease, the server records a failure within the reconciliation cycle. Restoring the same printer permits an explicit retry. A job with no lease in its entire history can instead be cancelled or replaced using its original browser check-in action credential, a reason and an idempotency key. Cancellation is audited and disables further retries on that original job. Replacement cancels the original and creates a separate package containing the same frozen document, addressed to the explicitly selected, currently online East or West gate printer. Repeating the same request returns the same package. Existing snapshots are never rerouted or rewritten.

`POST /api/v1/driver-print/packages/:packageId/recover-queued` accepts `{ "itemType": "DOCK_ASSIGNMENT", "action": "REPLACE", "gate": "WEST", "reason": "East queue replaced" }`, with `X-Idempotency-Key` and `X-Guard-Action-Key`. Use `action: "CANCEL"` to finish manually; gate is unnecessary. The response is the replacement package for replacement, or the original summary for cancellation. Item summaries expose `recoverable`, `cancelled`, and `replacementPackageId` for guard controls.

A leased job has an uncertain physical outcome and cannot use queue recovery, even after expiry or retry. Inspect the physical printer, then use its existing exact-printer retry or an authorized RXO reprint. Recovery never starts an additional physical print automatically.

Materials can upload corrected RXO document versions immediately after check-in. The original print package retains its first PDF; use the authorized reprint workflow for a later version.
