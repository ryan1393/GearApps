# Watcher Python dependencies

The W3 dependency set is exact-pinned and audited with pip-audit 2.10.1 on 2026-10-29. No known vulnerabilities were reported for the five pinned packages; the machine-readable result is `DEPENDENCY-AUDIT.json`. The explicit `packaging` pin covers pytesseract's transitive dependency.

| Package | Pin | Reason |
|---|---|---|
| pypdf | 6.21.4 | Removes PDF parsing/text-extraction denial-of-service advisories in older permitted 6.x releases. |
| PyMuPDF | 1.26.7 | Minimal patch from the tested 1.26.6 line; fixes PYSEC-2026-3001. |
| pytesseract | 0.3.13 | Audited stable OCR bridge. |
| Pillow | 13.0.0 | Removes the advisories affecting the previously allowed Pillow <13 releases. |
| packaging | 26.3 | Pins pytesseract's required version-parsing dependency. |

The text-only watcher continues to support Python 3.10+. Optional OCR now requires Python 3.11+ because patched Pillow 13 requires it. `INSTALL-WATCHER-SERVICE.ps1 -WithOcr` checks the actual service virtual environment and fails with a clear message on Python 3.10. On an existing OCR install, upgrade its Python environment to 3.11+ and run the installer with `-WithOcr` to update the optional packages. A text-only upgrade does not claim to audit or replace unrelated packages already present in that host's environment.

Validation in the isolated environment: 90 watcher tests ran, 88 passed, and the two Windows administrator NTFS tests skipped. The suite includes actual benign PDF extraction with pypdf, a PyMuPDF raster/Pillow roundtrip, and actual raster-only PDF OCR through the installed Tesseract executable. All five Windows x64/Python 3.11 wheels downloaded successfully. Wheel availability is not a Windows execution or printer-acceptance test.

Recheck after installing both requirement files:

```sh
python -m pip install -r requirements.txt -r requirements-ocr-optional.txt
python -m pip check
python -m unittest discover -s tests -v
pip-audit --no-deps --disable-pip -r requirements.txt -r requirements-ocr-optional.txt
```

The audit covers the Python dependency graph, not the separately installed Tesseract binary, Windows printer drivers, C# service host, or the guard's pinned Node/Sumatra executables. Native Windows service and printer testing remains required on the staging host.
