# Dock Board Optional Packing-Slip Upload

## Operator workflow

1. The guard checks the truck in and assigns the dock.
2. The dockworker opens the existing visit on **Dock Board**.
3. The dockworker may upload one PDF packing slip when it is available.
4. The existing upload path performs its legacy searchable-text scan. Its result is retained for compatibility but is marked for review; it is not equivalent to the strict Print Agent Delivery Number rule.
5. When a legacy ID is detected, the displayed/downloaded file name becomes `<SAP-ID>.pdf`.
6. When no labeled ID is detected, or multiple equally valid IDs are present, Truck Log stores the PDF for review and never guesses.
7. Re-uploading replaces the single current packing-slip record for that visit and adds a replacement event to the audit timeline.
8. **Dock Complete remains available whether the PDF is absent, detected, or still needs SAP-ID review.**
9. The dockworker gives the physical packing slip to the driver at the dock. The guard does **not** print the packing slip at final checkout.

## Scan Document and Find PDF

- **Scan Document** saves the scanned or typed Delivery Number to the visit. It then attaches the PDF the SAP watcher uploaded when exactly one validated capture carries that number, that capture is not attached to any visit, and the visit has no packing slip yet. Nobody previews the PDF in this case; the timeline shows "Packing-slip PDF matched the scanned number and was attached".
- If no capture or several captures match, or the visit already has a packing slip, Scan Document only saves the number.
- **Find PDF** saves the number and lists every available capture for it. The dockworker opens the PDF, checks it and confirms the attachment. Use it to choose between several captures or to replace the current slip.
- A capture reaches Truck Log only from a watcher route with **upload to Truck Log** switched on in Admin > Printing.

## Current rollout rule

Packing-slip upload is **optional for now**. The feature is available for training and real use, but it is not yet a Dock Complete requirement. A future controlled release may turn on enforcement after the plant confirms the workflow.

## Safety rules

- Packing slips are accepted only while the visit is `DOCK_ASSIGNED`.
- Only real PDFs with a valid `%PDF-` header are accepted.
- Exactly one current `PACKING_SLIP` document row can exist per visit.
- Automatic acceptance by the Print Agent requires a `Packing List` or `Packing Slip` marker and exactly one valid eight-digit Delivery Number. The Dock Board text extractor remains review-required unless the strict Print Agent rule has authoritatively validated the document.
- The API does not block Dock Complete when the packing slip is missing or the SAP ID is not detected.
- Dock Complete audit history records whether the optional packing slip was absent, detected, or pending review.
- Existing generic check-in/history paperwork uploads remain unchanged.
- The legacy Dock Board extractor supports searchable PDF text, Flate-compressed text streams, UTF-16 text, and common PDF ToUnicode maps. The dedicated Windows Print Agent owns the proven PyPDF → PyMuPDF → Tesseract OCR fallback; scanned image-only PDFs submitted through the legacy Dock Board remain review-required.
