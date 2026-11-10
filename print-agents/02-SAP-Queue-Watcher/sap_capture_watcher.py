#!/usr/bin/env python3
"""Truck Log SAP PDF capture queue watcher (independent restoration implementation).

Windows 'Microsoft Print to PDF' queues should write PDF files to their configured
route-specific C:\\TruckLog\\CaptureStaging\\routeN\\capture.pdf ports. This program
watches the completed files, classifies packing slips, optionally submits a
verified PDF to a real printer and moves the source to Ready/NeedsReview.

Route settings (name, source queue, output printer, mode OFF/TEST/LIVE, upload on/off)
come from Truck Log (Admin > Printing) via GET /api/v1/print-agents/packing-slip-routes.
watcher.ini holds machine-local settings only. Verified slips on routes with
uploadEnabled are queued in a durable outbox and uploaded to Truck Log
(POST /api/v1/print-agents/documents/packing-slip).

Runs in a console (START-WATCHER.cmd) or as the Windows service
TruckLogPackingSlipWatcher (WatcherServiceHost.cs starts `run --service`).

IMPORTANT: This is an independently reconstructed implementation, NOT the
original 2026 V3 Clean watcher.
"""
from __future__ import annotations

import argparse
import base64
import configparser
import datetime as dt
import hashlib
import json
import os
import random
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator, Optional, Union

WATCHER_VERSION = "sap-queue-watcher-reconstructed-2026.10.29-w3"
ROUTE_NAMES = {
    1: "West-Dock",
    2: "East-Dock",
    3: "Receiving-Dock",
    4: "Tube-Mill-Dock",
    5: "Forge-Dock",
    6: "North-Shipping-Dock",
    7: "Scheduling-Office",
    8: "DGL",
}
# Truck Log rejects packing-slip uploads above 25 MiB (FileInterceptor fileSize limit).
SERVER_MAX_PDF_BYTES = 25 * 1024 * 1024
MAX_PDF_BYTES = SERVER_MAX_PDF_BYTES
DELIVERY_PATTERN = re.compile(r"\bDelivery\s*(?:Number|No\.?|#|Nr\.?)\s*[:#-]?\s*(?<!\d)(\d{8})(?!\d)", re.I)
PACKING_MARKER = re.compile(r"\bPacking\s+(?:Slip|List)\b", re.I)

# Values must match libs/truck-log/server/feature/print-agents/src/lib/dto/packing-slip-ingestion.dto.ts
DETECTION_METHODS = ("PYPDF_TEXT", "PYMUPDF_TEXT", "OCR")
PRINT_STATUSES = ("PENDING", "PRINTED", "FAILED", "SKIPPED")
METADATA_FIELDS = (
    "sourceCaptureId", "documentType", "sapDocumentId", "detectionMethod",
    "positiveMarkersFound", "identifierCandidates", "confidence", "route",
    "sourceQueue", "outputPrinter", "capturedAt", "printStatus", "printError",
    "clientReportedSha256", "reviewReason",
)
SOURCE_CAPTURE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$")
IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$")
UPLOAD_PATH = "/print-agents/documents/packing-slip"
SETUP_CHECK_PATH = "/print-agents/setup-check"
TEST_MODE_PRINTER = "TEST_MODE_NO_PRINT"
RECOVERED_PRINTER = "RECOVERED_AFTER_OVERWRITE_NO_PRINT"
CAPTURED_WHILE_OFF_PRINTER = "CAPTURED_WHILE_ROUTE_OFF_NO_PRINT"

# Route settings document served by Truck Log (contract: watcher-config-contract.md).
ROUTES_PATH = "/print-agents/packing-slip-routes"
ROUTE_MODES = ("OFF", "TEST", "LIVE")
ROUTE_COUNT = 8
ROUTE_CONFIG_CACHE = "route-config.json"
ROUTE_CONFIG_CACHE_FORMAT = "truck-log-packing-slip-routes-cache-v1"
ROUTE_CONFIG_REFRESH_SECONDS = 60.0
UNC_PRINTER_PATTERN = re.compile(r'^\\\\[A-Za-z0-9._-]+\\[^\\/:*?"<>|\x00-\x1f]{1,200}$')
_CONTROL_CHARS = re.compile(r"[\x00-\x1f]")
# Local safety net (not part of the server contract): never print into a PDF/capture queue,
# which would feed the slip back into a capture route.
_CAPTURE_LIKE_PRINTER = re.compile(r"pdf|capture|print\s*to\s*pdf", re.I)

SERVICE_NAME = "TruckLogPackingSlipWatcher"
LEGACY_ROUTE_KEYS = ("name", "enabled", "physical_printer", "source_queue", "test_mode")

TOKEN_PATTERN = re.compile(r"^tlpa_[0-9a-f]{16}_[0-9a-f]{64}$")
_TOKEN_ANYWHERE = re.compile(r"tlpa_([0-9A-Fa-f]{16})_[0-9A-Fa-f]{8,}")
_BEARER_ANYWHERE = re.compile(r"(Bearer\s+)(?!tlpa_[0-9A-Fa-f]{16}_\[REDACTED\])\S+", re.I)
CREDENTIAL_FORMAT = "truck-log-sap-watcher-credential-v1"
DPAPI_ENTROPY = b"TruckLog.SAPQueueWatcher.UploadToken.v1"


class WatcherError(RuntimeError):
    pass


def redact(value: Any) -> str:
    """Remove Print Agent bearer secrets from text before it is logged or stored."""
    text = str(value)
    text = _TOKEN_ANYWHERE.sub(r"tlpa_\1_[REDACTED]", text)
    return _BEARER_ANYWHERE.sub(r"\1[REDACTED]", text)


def iso_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def iso_utc_ms(moment: Optional[dt.datetime] = None) -> str:
    """ISO-8601 like JavaScript Date.toISOString(), which Truck Log stores."""
    moment = (moment or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as src:
        for chunk in iter(lambda: src.read(256 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temp.open("w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, indent=2, sort_keys=True, ensure_ascii=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


def expand_path(value: str) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(value.strip().strip('"'))))


@dataclass(frozen=True)
class RoutePaths:
    """Machine-local folders of one route (watcher.ini); never come from Truck Log."""
    number: int
    capture_file: Path
    incoming: Path
    ready: Path
    needs_review: Path


@dataclass(frozen=True)
class Route:
    """Effective settings of one route: local folders + Truck Log route settings."""
    number: int
    name: str
    capture_file: Path
    incoming: Path
    ready: Path
    needs_review: Path
    printer: str = ""
    mode: str = "TEST"               # OFF | TEST | LIVE
    upload_enabled: bool = False
    source_queue: str = ""

    @property
    def enabled(self) -> bool:
        return self.mode != "OFF"

    @property
    def live(self) -> bool:
        return self.mode == "LIVE"

    @property
    def queue_name(self) -> str:
        return self.source_queue or f"SAP-Capture-route{self.number}"

    @property
    def paths(self) -> RoutePaths:
        return RoutePaths(self.number, self.capture_file, self.incoming, self.ready, self.needs_review)


@dataclass(frozen=True)
class TruckLogSettings:
    api_base: str = ""
    allow_http: bool = False
    credential_file: Path = Path(r"C:\TruckLog\SAPWatcherState\truck-log-upload.credential")
    credential_format: str = "dpapi"          # dpapi | file
    dpapi_scope: str = "LocalMachine"         # LocalMachine (service) | CurrentUser
    agent_id: str = ""
    source_host: str = ""
    timeout_seconds: float = 30.0
    retry_initial_seconds: float = 30.0
    retry_max_seconds: float = 900.0
    use_system_proxy: bool = False

    @property
    def configured(self) -> bool:
        return bool(self.api_base)


@dataclass(frozen=True)
class Settings:
    route_paths: tuple[RoutePaths, ...]
    state_dir: Path
    sumatra: Path
    poll_seconds: float
    settle_seconds: float
    ocr_enabled: bool
    max_pdf_bytes: int
    truck_log: TruckLogSettings = TruckLogSettings()
    config_refresh_seconds: float = ROUTE_CONFIG_REFRESH_SECONDS
    max_pending_captures: int = 500


def normalize_api_base(value: str, allow_http: bool) -> str:
    raw = value.strip().strip('"').rstrip("/")
    parts = urllib.parse.urlsplit(raw)
    if parts.scheme not in ("https", "http") or not parts.hostname:
        raise WatcherError("[truck_log] api_base must be an absolute https:// URL, e.g. https://trucklog.example/api/v1")
    if parts.scheme == "http" and not allow_http:
        raise WatcherError("[truck_log] api_base uses http://; use https:// or set allow_http = yes (LAN only)")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise WatcherError("[truck_log] api_base must not contain credentials, a query string or a fragment")
    return raw


def safe_capture_token(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9.-]", "-", value).strip(".-")
    return cleaned[:40] or "print-pc"


def load_config(path: Path) -> Settings:
    """Read watcher.ini: machine-local settings only (route settings live in Truck Log)."""
    if not path.is_file():
        raise WatcherError(f"Configuration not found: {path}")
    c = configparser.ConfigParser(interpolation=None)
    c.read(path, encoding="utf-8-sig")
    if not c.has_section("watcher"):
        c.add_section("watcher")
    moved = "now set in Truck Log > Admin > Printing; remove it from watcher.ini (see README.txt)"
    if c.has_option("watcher", "live_print_armed"):
        raise WatcherError("[watcher] live_print_armed is no longer used: printing is switched on per route with "
                           "mode LIVE in Truck Log > Admin > Printing. Remove the line from watcher.ini.")
    root = Path(r"C:\TruckLog")
    capture_root = expand_path(c.get("watcher", "capture_root", fallback=str(root / "CaptureStaging")))
    packing_root = expand_path(c.get("watcher", "packing_root", fallback=str(root / "PackingSlips")))
    state_dir = expand_path(c.get("watcher", "state_dir", fallback=str(root / "SAPWatcherState")))
    sumatra = expand_path(c.get("watcher", "sumatra_path", fallback=r"C:\ProgramData\Dana\TruckLogPrintAgent\SumatraPDF.exe"))
    poll = c.getfloat("watcher", "poll_seconds", fallback=1.5)
    settle = c.getfloat("watcher", "settle_seconds", fallback=2.0)
    ocr = c.getboolean("watcher", "ocr_enabled", fallback=False)
    max_size = int(c.getfloat("watcher", "max_pdf_mb", fallback=25) * 1024 * 1024)
    if not (0.3 <= poll <= 60 and 0.5 <= settle <= 60 and 1 <= max_size <= 100 * 1024 * 1024):
        raise WatcherError("Invalid poll_seconds, settle_seconds, or max_pdf_mb setting")

    tl = TruckLogSettings(credential_file=state_dir / "truck-log-upload.credential")
    if c.has_section("truck_log"):
        s = "truck_log"
        if c.has_option(s, "enabled"):
            raise WatcherError("[truck_log] enabled is no longer used: upload is switched on per route "
                               f"(uploadEnabled) {moved}")
        allow_http = c.getboolean(s, "allow_http", fallback=False)
        api_base = c.get(s, "api_base", fallback="").strip()
        if api_base:
            api_base = normalize_api_base(api_base, allow_http)
        for forbidden in ("token", "bearer_token", "api_token", "secret"):
            if c.has_option(s, forbidden):
                raise WatcherError(f"[truck_log] {forbidden} must not be stored in watcher.ini; run SETUP-TRUCK-LOG-UPLOAD.cmd")
        fmt = c.get(s, "credential_format", fallback="dpapi").strip().lower()
        scope = c.get(s, "dpapi_scope", fallback="LocalMachine").strip()
        if fmt not in ("dpapi", "file"):
            raise WatcherError("[truck_log] credential_format must be dpapi or file")
        if scope.lower() not in ("currentuser", "localmachine"):
            raise WatcherError("[truck_log] dpapi_scope must be LocalMachine or CurrentUser")
        scope = "LocalMachine" if scope.lower() == "localmachine" else "CurrentUser"
        tl = TruckLogSettings(
            api_base=api_base,
            allow_http=allow_http,
            credential_file=expand_path(c.get(s, "credential_file", fallback=str(state_dir / "truck-log-upload.credential"))),
            credential_format=fmt,
            dpapi_scope=scope,
            agent_id=c.get(s, "agent_id", fallback="").strip(),
            source_host=safe_capture_token(c.get(s, "source_host", fallback="").strip() or socket.gethostname()),
            timeout_seconds=c.getfloat(s, "timeout_seconds", fallback=30.0),
            retry_initial_seconds=c.getfloat(s, "retry_initial_seconds", fallback=30.0),
            retry_max_seconds=c.getfloat(s, "retry_max_seconds", fallback=900.0),
            use_system_proxy=c.getboolean(s, "use_system_proxy", fallback=False),
        )
        if not (1 <= tl.timeout_seconds <= 300 and 1 <= tl.retry_initial_seconds <= tl.retry_max_seconds <= 86400):
            raise WatcherError("[truck_log] invalid timeout_seconds or retry_* setting")
        if tl.agent_id and not re.match(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$", tl.agent_id):
            raise WatcherError("[truck_log] agent_id has an invalid format")
    if tl.configured and max_size > SERVER_MAX_PDF_BYTES:
        raise WatcherError("max_pdf_mb must be 25 or less while a Truck Log api_base is set (server limit 25 MiB)")

    paths: list[RoutePaths] = []
    for n, folder in ROUTE_NAMES.items():
        sec = f"route{n}"
        if c.has_section(sec):
            legacy = [k for k in LEGACY_ROUTE_KEYS if c.has_option(sec, k)]
            if legacy:
                raise WatcherError(f"[{sec}] {', '.join(legacy)}: route settings are {moved}. "
                                   f"Only capture_file/incoming/ready/needs_review may be overridden in [{sec}].")
        target = packing_root / folder
        paths.append(RoutePaths(
            n,
            expand_path(c.get(sec, "capture_file", fallback=str(capture_root / f"route{n}" / "capture.pdf"))),
            expand_path(c.get(sec, "incoming", fallback=str(target / "Incoming"))),
            expand_path(c.get(sec, "ready", fallback=str(target / "Ready"))),
            expand_path(c.get(sec, "needs_review", fallback=str(target / "NeedsReview"))),
        ))
    validate_paths(paths)
    max_pending = c.getint("watcher", "max_pending_captures", fallback=500)
    if not 1 <= max_pending <= 10000:
        raise WatcherError("max_pending_captures must be between 1 and 10000")
    return Settings(tuple(paths), state_dir, sumatra, poll, settle, ocr, max_size, tl,
                    max_pending_captures=max_pending)


def _norm(path: Path) -> str:
    return os.path.normcase(os.path.abspath(str(path))).lower()


def validate_paths(routes: Iterable[Union[RoutePaths, Route]]) -> None:
    """Local folders must not overlap within or across routes (all 8, whatever their mode)."""
    routes = list(routes)
    used: set[str] = set()
    for r in routes:
        resolved = [_norm(x) for x in (r.capture_file, r.incoming, r.ready, r.needs_review)]
        if len(set(resolved)) != len(resolved):
            raise WatcherError(f"route{r.number}: overlapping file/folder destinations")
        for x in resolved:
            if x in used:
                raise WatcherError(f"route{r.number}: path reused across routes: {x}")
            used.add(x)
    # Source file must not be under an output folder (infinite rescan/overwrites).
    for r in routes:
        source = _norm(r.capture_file)
        for d in (r.incoming, r.ready, r.needs_review):
            folder = _norm(d).rstrip("/\\")
            if source.startswith(folder + os.sep.lower()):
                raise WatcherError(f"route{r.number}: capture is inside an output folder")


# ---------------------------------------------------------------------------
# Route settings from Truck Log (GET /print-agents/packing-slip-routes)
# ---------------------------------------------------------------------------

def default_route_name(number: int) -> str:
    return ROUTE_NAMES[number].replace("-", " ")


def _plain_string(value: Any, field: str, lo: int, hi: int) -> str:
    if not isinstance(value, str):
        raise WatcherError(f"{field} must be a string")
    if not lo <= len(value) <= hi:
        raise WatcherError(f"{field} must be {lo}-{hi} characters")
    if _CONTROL_CHARS.search(value):
        raise WatcherError(f"{field} contains control characters")
    return value


def validate_route_document(doc: Any) -> dict[str, Any]:
    """Re-check the server rules. Any violation rejects the WHOLE document (raises)."""
    if not isinstance(doc, dict):
        raise WatcherError("route settings document is not a JSON object")
    version = doc.get("version")
    if type(version) is not int or version < 1:
        raise WatcherError("version must be a positive integer")
    for optional in ("updatedAt", "updatedBy"):
        if doc.get(optional) is not None:
            _plain_string(doc[optional], optional, 0, 200)
    routes = doc.get("routes")
    if not isinstance(routes, list) or len(routes) != ROUTE_COUNT:
        raise WatcherError(f"routes must list exactly routes 1..{ROUTE_COUNT}")
    queues: set[str] = set()
    for i, r in enumerate(routes, start=1):
        if not isinstance(r, dict):
            raise WatcherError(f"routes[{i - 1}] is not an object")
        if type(r.get("route")) is not int or r["route"] != i:
            raise WatcherError("routes must be exactly 1..8 sorted by route")
        where = f"route {i}"
        _plain_string(r.get("name"), f"{where} name", 1, 60)
        if not r["name"].strip():
            raise WatcherError(f"{where} name must not be blank")
        queue = _plain_string(r.get("sourceQueue"), f"{where} sourceQueue", 1, 120)
        printer = _plain_string(r.get("outputPrinter", ""), f"{where} outputPrinter", 0, 260)
        mode = r.get("mode")
        if mode not in ROUTE_MODES:
            raise WatcherError(f"{where} mode must be OFF, TEST or LIVE")
        if not isinstance(r.get("uploadEnabled"), bool):
            raise WatcherError(f"{where} uploadEnabled must be true or false")
        if printer and not UNC_PRINTER_PATTERN.fullmatch(printer):
            raise WatcherError(f"{where} outputPrinter must be a UNC printer path like \\\\server\\queue")
        if mode == "LIVE" and not printer:
            raise WatcherError(f"{where} is LIVE but has no outputPrinter")
        if mode != "OFF":
            if queue in queues:
                raise WatcherError(f"{where} sourceQueue is used by another route that is not OFF")
            queues.add(queue)
        for key, value in r.items():
            if isinstance(value, str) and _CONTROL_CHARS.search(value):
                raise WatcherError(f"{where} {key} contains control characters")
    return doc


def safe_default_document() -> dict[str, Any]:
    """No Truck Log answer and no cache yet: every route TEST, upload off (never prints)."""
    return {"version": 0, "updatedAt": None, "updatedBy": None,
            "routes": [{"route": n, "name": default_route_name(n), "sourceQueue": f"SAP-Capture-route{n}",
                        "outputPrinter": "", "mode": "TEST", "uploadEnabled": False}
                       for n in range(1, ROUTE_COUNT + 1)]}


def build_routes(doc: dict[str, Any], paths: Iterable[RoutePaths]) -> tuple[tuple[Route, ...], list[str]]:
    """Combine a validated document with the local folders. Returns (routes, local safety warnings)."""
    by_number = {r["route"]: r for r in doc["routes"]}
    queues = {str(r["sourceQueue"]).lower() for r in doc["routes"]}
    warnings: list[str] = []
    out: list[Route] = []
    for p in paths:
        r = by_number[p.number]
        mode, printer = r["mode"], r.get("outputPrinter") or ""
        if mode == "LIVE":
            queue_part = printer.rsplit("\\", 1)[-1].lower()
            if _CAPTURE_LIKE_PRINTER.search(printer) or queue_part in queues:
                warnings.append(f"route {p.number} {r['name']}: LIVE refused on this PC because outputPrinter "
                                f"{printer} looks like a PDF/capture queue; running as TEST")
                mode = "TEST"
        out.append(Route(p.number, r["name"].strip(), p.capture_file, p.incoming, p.ready, p.needs_review,
                         printer, mode, bool(r["uploadEnabled"]), r["sourceQueue"].strip()))
    return tuple(out), warnings


@dataclass
class FetchResult:
    outcome: str                      # updated | not_modified | unreachable | rejected | not_configured
    document: Optional[dict[str, Any]] = None
    message: str = ""


class RouteConfigClient:
    """Fetches and caches the route settings document. Thread-safe; never raises on network errors."""

    def __init__(self, settings: TruckLogSettings, state_dir: Path, token_provider: Callable[[], str],
                 log: Callable[[str, str], None], *, http: Callable[..., HttpResult] = None,  # type: ignore[assignment]
                 on_auth_failure: Optional[Callable[[], None]] = None):
        self.s = settings
        self.cache_path = state_dir / ROUTE_CONFIG_CACHE
        self.token_provider = token_provider
        self.log = log
        self.http = http or http_request
        self.on_auth_failure = on_auth_failure
        self.outage: Optional[str] = None
        self._rejected_logged: Optional[str] = None
        self._lock = threading.Lock()
        self._pending: Optional[dict[str, Any]] = None
        self.last_confirmed_write = 0.0

    # -- cache ---------------------------------------------------------------
    def load_cache(self) -> Optional[dict[str, Any]]:
        """Return the cache wrapper {document, savedAt, confirmedAt} or None (missing/invalid)."""
        try:
            wrapper = json.loads(self.cache_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as e:
            self.log("WARN", f"route settings cache {self.cache_path} unreadable ({type(e).__name__}); ignored")
            return None
        try:
            if not isinstance(wrapper, dict) or wrapper.get("format") != ROUTE_CONFIG_CACHE_FORMAT:
                raise WatcherError("unknown cache format")
            validate_route_document(wrapper.get("document"))
        except WatcherError as e:
            self.log("WARN", f"route settings cache {self.cache_path} invalid ({redact(e)}); ignored")
            return None
        return wrapper

    def save_cache(self, doc: dict[str, Any], saved_at: Optional[str] = None) -> None:
        now = iso_utc()
        write_json_atomic(self.cache_path, {"format": ROUTE_CONFIG_CACHE_FORMAT, "savedAt": saved_at or now,
                                            "confirmedAt": now, "document": doc})
        self.last_confirmed_write = time.monotonic()

    def _touch_confirmed(self, doc: dict[str, Any]) -> None:
        # A 304 confirms the cache is current; persist that at most every 5 minutes.
        if time.monotonic() - self.last_confirmed_write < 300:
            return
        wrapper = self.load_cache()
        if wrapper and wrapper["document"].get("version") == doc.get("version"):
            try:
                self.save_cache(wrapper["document"], wrapper.get("savedAt"))
            except OSError:
                pass

    # -- network -------------------------------------------------------------
    def request(self, known_version: Optional[int]) -> FetchResult:
        """One GET; read-only (no cache write, no logging)."""
        if not self.s.configured:
            return FetchResult("not_configured", message="[truck_log] api_base is not set")
        try:
            token = self.token_provider()
        except (WatcherError, OSError) as e:
            return FetchResult("unreachable", message=f"credential unavailable: {redact(e)}")
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json", "User-Agent": WATCHER_VERSION}
        if known_version:
            headers["If-None-Match"] = f'"{known_version}"'
        result = self.http("GET", self.s.api_base + ROUTES_PATH, headers=headers, body=None,
                           timeout=self.s.timeout_seconds, use_system_proxy=self.s.use_system_proxy)
        if result.status == 304:
            return FetchResult("not_modified")
        if result.status != 200:
            msg = server_message(result)
            if 300 <= result.status < 400:
                msg += " (redirect refused; check [truck_log] api_base)"
            elif result.status in (401, 403):
                msg += " (credential rejected or lacks documents:upload; re-run SETUP-TRUCK-LOG-UPLOAD.cmd)"
                if self.on_auth_failure:
                    self.on_auth_failure()
            elif result.status == 404:
                msg += " (this Truck Log does not serve route settings yet; it needs migration 0004)"
            return FetchResult("unreachable", message=msg)
        try:
            doc = json.loads(result.body.decode("utf-8"))
            validate_route_document(doc)
        except (ValueError, UnicodeDecodeError) as e:
            return FetchResult("rejected", message=f"response is not valid JSON ({type(e).__name__})")
        except WatcherError as e:
            return FetchResult("rejected", message=redact(e))
        return FetchResult("updated", doc)

    def refresh(self, current: Optional[dict[str, Any]]) -> FetchResult:
        """Fetch, log outages once, cache a good new document and hand it to the main loop."""
        known = current.get("version") if current else None
        res = self.request(known or None)
        if res.outcome in ("unreachable", "not_configured"):
            if self.outage is None:
                self.outage = res.message
                self.log("CONFIG-OFFLINE", f"route settings not available from Truck Log: {res.message}. "
                                           "Keeping the current route settings.")
            return res
        if self.outage is not None:
            self.log("CONFIG", "Truck Log route settings reachable again")
            self.outage = None
        if res.outcome == "rejected":
            if self._rejected_logged != res.message:
                self._rejected_logged = res.message
                self.log("CONFIG-REJECT", f"route settings document rejected as a whole: {res.message}. "
                                          "Keeping the current route settings.")
            return res
        self._rejected_logged = None
        if res.outcome == "not_modified":
            if current:
                self._touch_confirmed(current)
            return res
        assert res.document is not None
        try:
            self.save_cache(res.document)
        except OSError as e:
            self.log("WARN", f"could not write {self.cache_path}: {type(e).__name__}")
        with self._lock:
            self._pending = res.document
        return res

    def take_pending(self) -> Optional[dict[str, Any]]:
        with self._lock:
            doc, self._pending = self._pending, None
        return doc


class RouteConfigPoller(threading.Thread):
    """Background refresh so a slow Truck Log never delays capture polling."""

    def __init__(self, client: RouteConfigClient, current: Callable[[], Optional[dict[str, Any]]],
                 interval: float, log: Callable[[str, str], None]):
        super().__init__(name="route-config", daemon=True)
        self.client, self.current, self.interval, self.log = client, current, interval, log
        self.stop_event = threading.Event()

    def run(self) -> None:
        while not self.stop_event.wait(self.interval):
            try:
                self.client.refresh(self.current())
            except Exception as e:  # never kill the poller
                self.log("CONFIG-OFFLINE", f"route settings refresh error {type(e).__name__}: {redact(e)}")

    def stop(self) -> None:
        self.stop_event.set()


# ---------------------------------------------------------------------------
# PDF text extraction and packing-slip verification
# ---------------------------------------------------------------------------

def pdf_text_layers(path: Path, ocr_enabled: bool = False) -> Iterator[tuple[str, str]]:
    """Yield (detectionMethod, text) lazily: pypdf, then PyMuPDF, then optional OCR.

    The consumer stops as soon as a layer verifies, so OCR only runs when the
    text layers did not contain a marker plus exactly one labelled Delivery Number.
    """
    errors: list[str] = []
    produced = False
    try:
        from pypdf import PdfReader  # type: ignore[import-not-found]
        reader = PdfReader(str(path), strict=True)
        text = "\n".join((p.extract_text() or "") for p in list(reader.pages)[:35])
        if text.strip():
            produced = True
            yield "PYPDF_TEXT", text
    except Exception as e:
        errors.append(f"pypdf: {type(e).__name__}")
    try:
        import fitz  # type: ignore[import-not-found]
        with fitz.open(str(path)) as doc:
            text = "\n".join(page.get_text() for page in list(doc)[:35])
            if text.strip():
                produced = True
                yield "PYMUPDF_TEXT", text
            if ocr_enabled:
                import pytesseract  # type: ignore[import-not-found]
                from PIL import Image  # type: ignore[import-not-found]
                ocr: list[str] = []
                for page in list(doc)[:3]:
                    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                    im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                    ocr.append(pytesseract.image_to_string(im, timeout=45))
                text = "\n".join(ocr)
                if text.strip():
                    produced = True
                    yield "OCR", text
    except Exception as e:
        errors.append(f"PyMuPDF/OCR: {type(e).__name__}")
    if not produced:
        raise WatcherError("No extractable PDF text; install pypdf, optionally PyMuPDF/OCR; " + ", ".join(errors))


def pdf_text(path: Path, ocr_enabled: bool = False) -> str:
    """Backward-compatible helper: first non-empty text layer."""
    for _method, text in pdf_text_layers(path, ocr_enabled):
        return text
    return ""


def classify_text(text: str) -> tuple[bool, str]:
    if not PACKING_MARKER.search(text):
        return False, "No Packing Slip/Packing List marker"
    ids = sorted(set(DELIVERY_PATTERN.findall(text)))
    if len(ids) != 1:
        return False, f"Expected exactly one unique 8-digit Delivery Number, found {len(ids)}"
    return True, ids[0]


def markers_in(text: str) -> list[str]:
    found = {" ".join(m.group(0).split()).title() for m in PACKING_MARKER.finditer(text)}
    return sorted(found)[:10]


@dataclass(frozen=True)
class Verification:
    ok: bool
    delivery_number: str = ""
    method: str = ""
    markers: tuple[str, ...] = ()
    reason: str = ""


def verify_layers(layers: Iterable[tuple[str, str]]) -> Verification:
    """Accept the first layer with a marker and exactly one labelled Delivery Number.

    A layer showing two or more different labelled numbers is ambiguous and is
    rejected outright; a later extractor (e.g. OCR) is never allowed to override it.
    """
    reason = "No extractable PDF text"
    for method, text in layers:
        if method not in DETECTION_METHODS:
            raise WatcherError(f"Unknown detection method {method!r}")
        if not text.strip():
            continue
        ids = sorted(set(DELIVERY_PATTERN.findall(text)))
        if len(ids) > 1:
            return Verification(False, method=method, reason=f"Expected exactly one unique 8-digit Delivery Number, found {len(ids)} ({method})")
        good, detail = classify_text(text)
        if good:
            return Verification(True, detail, method, tuple(markers_in(text)))
        reason = f"{detail} ({method})"
    return Verification(False, reason=reason)


def validate_pdf_file(path: Path, limit: int) -> None:
    if not path.is_file():
        raise WatcherError("Captured PDF does not exist")
    size = path.stat().st_size
    if size < 20 or size > limit:
        raise WatcherError(f"PDF size out of bounds: {size} bytes")
    with path.open("rb") as f:
        if not f.read(8).startswith(b"%PDF-"):
            raise WatcherError("Missing PDF file header")
        f.seek(max(0, size - 4096))
        if b"%%EOF" not in f.read():
            raise WatcherError("Missing PDF file trailer; may still be writing")


def looks_complete_pdf(data: bytes) -> bool:
    return data.startswith(b"%PDF-") and b"%%EOF" in data[-4096:]


# ---------------------------------------------------------------------------
# Truck Log metadata (mirror of parsePackingSlipIngestionMetadata + validationFor)
# ---------------------------------------------------------------------------

def build_packing_slip_metadata(*, source_capture_id: str, verification: Verification, route: Route,
                                output_printer: str, captured_at: str, print_status: str,
                                sha256: str, print_error: Optional[str] = None,
                                review_reason: Optional[str] = None) -> dict[str, Any]:
    if not verification.ok:
        raise WatcherError("Refusing to build upload metadata for an unverified PDF")
    md: dict[str, Any] = {
        "sourceCaptureId": source_capture_id,
        "documentType": "PACKING_SLIP",
        "sapDocumentId": verification.delivery_number,
        "detectionMethod": verification.method,
        "positiveMarkersFound": list(verification.markers),
        "identifierCandidates": [verification.delivery_number],
        "route": route.name.strip(),
        "sourceQueue": route.queue_name.strip(),
        "outputPrinter": output_printer.strip(),
        "capturedAt": captured_at,
        "printStatus": print_status,
        "clientReportedSha256": sha256,
    }
    if print_status == "FAILED":
        md["printError"] = redact(print_error or "Print submission failed")[:2000]
    if review_reason:
        md["reviewReason"] = review_reason[:2000]
    validate_packing_slip_metadata(md)
    return md


def validate_packing_slip_metadata(md: dict[str, Any]) -> None:
    """Client-side copy of the server rules so a bad record never leaves the PC."""
    unknown = [k for k in md if k not in METADATA_FIELDS]
    if unknown:
        raise WatcherError(f"metadata contains unsupported fields: {', '.join(unknown)}")

    def req(name: str, limit: int) -> str:
        v = md.get(name)
        if not isinstance(v, str) or not v.strip() or len(v.strip()) > limit:
            raise WatcherError(f"{name} must be a non-empty string of at most {limit} characters")
        return v

    if req("documentType", 60) != "PACKING_SLIP":
        raise WatcherError("documentType must be PACKING_SLIP")
    if req("detectionMethod", 80) not in DETECTION_METHODS:
        raise WatcherError("detectionMethod is not supported by Truck Log")
    status = req("printStatus", 40)
    if status not in PRINT_STATUSES:
        raise WatcherError("printStatus is not supported by Truck Log")
    if (status == "FAILED") != bool(md.get("printError")):
        raise WatcherError("printError is required only when printStatus is FAILED")
    if not SOURCE_CAPTURE_ID_PATTERN.match(req("sourceCaptureId", 120)):
        raise WatcherError("sourceCaptureId has an invalid format")
    req("route", 120)
    req("sourceQueue", 255)
    req("outputPrinter", 255)
    captured = req("capturedAt", 40)
    try:
        when = dt.datetime.fromisoformat(captured.replace("Z", "+00:00"))
    except ValueError as e:
        raise WatcherError("capturedAt must be ISO-8601") from e
    if when.tzinfo is None or when > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5):
        raise WatcherError("capturedAt must be a UTC timestamp not in the future")
    if not re.fullmatch(r"[0-9a-f]{64}", str(md.get("clientReportedSha256", ""))):
        raise WatcherError("clientReportedSha256 must be 64 lowercase hex characters")
    markers = md.get("positiveMarkersFound")
    if not isinstance(markers, list) or not 1 <= len(markers) <= 10 or \
            not any(" ".join(str(m).lower().split()) in ("packing slip", "packing list") for m in markers):
        raise WatcherError("positiveMarkersFound must contain Packing Slip or Packing List")
    cands = md.get("identifierCandidates")
    if not isinstance(cands, list) or len(cands) != 1 or not re.fullmatch(r"\d{8}", str(cands[0])):
        raise WatcherError("identifierCandidates must be exactly the one labelled 8-digit Delivery Number")
    if md.get("sapDocumentId") != cands[0]:
        raise WatcherError("sapDocumentId must equal the labelled Delivery Number")
    for optional in ("printError", "reviewReason"):
        if optional in md and (not isinstance(md[optional], str) or len(md[optional]) > 2000):
            raise WatcherError(f"{optional} must be at most 2000 characters")
    if len(json.dumps(md).encode("utf-8")) > 64 * 1024:
        raise WatcherError("metadata exceeds the 64 KiB limit")


def build_multipart(metadata: dict[str, Any], pdf: bytes, filename: str) -> tuple[str, bytes]:
    boundary = "TruckLogSAPWatcher" + uuid.uuid4().hex
    safe_name = re.sub(r"[^A-Za-z0-9._ ()-]", "_", filename)[:200] or "packing-slip.pdf"
    meta = json.dumps(metadata, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body = b"".join([
        f"--{boundary}\r\n".encode("ascii"),
        b'Content-Disposition: form-data; name="metadata"\r\n',
        b"Content-Type: text/plain; charset=utf-8\r\n\r\n",
        meta, b"\r\n",
        f"--{boundary}\r\n".encode("ascii"),
        f'Content-Disposition: form-data; name="file"; filename="{safe_name}"\r\n'.encode("ascii"),
        b"Content-Type: application/pdf\r\n\r\n",
        pdf, b"\r\n",
        f"--{boundary}--\r\n".encode("ascii"),
    ])
    return f"multipart/form-data; boundary={boundary}", body


# ---------------------------------------------------------------------------
# Credential storage (Windows DPAPI)
# ---------------------------------------------------------------------------

def _dpapi(data: bytes, protect: bool, local_machine: bool) -> bytes:
    if os.name != "nt":
        raise WatcherError("Windows DPAPI is only available on Windows; use credential_format = file elsewhere")
    import ctypes
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def blob(raw: bytes):
        buf = ctypes.create_string_buffer(raw, len(raw))
        return DATA_BLOB(len(raw), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf

    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    proto = [ctypes.POINTER(DATA_BLOB), wintypes.LPCWSTR, ctypes.POINTER(DATA_BLOB),
             ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(DATA_BLOB)]
    crypt32.CryptProtectData.argtypes = proto
    crypt32.CryptProtectData.restype = wintypes.BOOL
    unproto = list(proto)
    unproto[1] = ctypes.c_void_p
    crypt32.CryptUnprotectData.argtypes = unproto
    crypt32.CryptUnprotectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    CRYPTPROTECT_UI_FORBIDDEN, CRYPTPROTECT_LOCAL_MACHINE = 0x1, 0x4
    flags = CRYPTPROTECT_UI_FORBIDDEN | (CRYPTPROTECT_LOCAL_MACHINE if (protect and local_machine) else 0)
    data_in, keep_in = blob(data)
    entropy, keep_entropy = blob(DPAPI_ENTROPY)
    out = DATA_BLOB()
    if protect:
        ok = crypt32.CryptProtectData(ctypes.byref(data_in), "Truck Log SAP watcher upload token",
                                      ctypes.byref(entropy), None, None, flags, ctypes.byref(out))
    else:
        ok = crypt32.CryptUnprotectData(ctypes.byref(data_in), None, ctypes.byref(entropy),
                                        None, None, flags, ctypes.byref(out))
    if not ok:
        raise WatcherError(f"DPAPI {'protect' if protect else 'unprotect'} failed (Windows error {ctypes.get_last_error()}); "
                           "a CurrentUser credential cannot be read by the LocalSystem service: run "
                           "INSTALL-WATCHER-SERVICE.cmd (migrates it) or SETUP-TRUCK-LOG-UPLOAD.cmd as Administrator")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(out.pbData, ctypes.c_void_p))
        del keep_in, keep_entropy


def protect_credential_acl(path: Path, runner: Callable[..., Any] = subprocess.run) -> None:
    """Credential readable only by SYSTEM and Administrators (the service runs as LocalSystem).

    With dpapi_scope = LocalMachine every account on the PC could decrypt the blob, so the file
    ACL is the real protection (same model as the guard agent's machine-sealed credential).
    """
    if os.name != "nt":
        os.chmod(path, 0o600)
        return
    icacls = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "icacls.exe")
    proc = runner([icacls, str(path), "/inheritance:r", "/grant:r", "*S-1-5-18:F", "*S-1-5-32-544:F"],
                  stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    if proc.returncode != 0:
        raise WatcherError(f"Could not restrict the credential file ACL (icacls exit {proc.returncode}); "
                           "run SETUP-TRUCK-LOG-UPLOAD.cmd as Administrator")


def _write_secret_file(path: Path, data: bytes) -> None:
    """Create a temp file, lock its ACL down BEFORE writing the secret, then atomically replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    fd = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    try:
        os.close(fd)
        protect_credential_acl(temp)
        with temp.open("wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)  # NTFS rename keeps the temp file's restricted ACL
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


def store_token(settings: TruckLogSettings, token: str, scope: Optional[str] = None) -> None:
    token = token.strip()
    if not TOKEN_PATTERN.match(token):
        raise WatcherError("Token must look like tlpa_<16 hex>_<64 hex> (as printed once by provision-print-agent)")
    scope = scope or settings.dpapi_scope
    if settings.credential_format == "dpapi":
        blob = _dpapi(token.encode("ascii"), True, scope == "LocalMachine")
        doc = {"format": CREDENTIAL_FORMAT, "protection": f"dpapi-{scope}",
               "data": base64.b64encode(blob).decode("ascii"), "keyId": token.split("_")[1], "storedAt": iso_utc()}
        _write_secret_file(settings.credential_file, (json.dumps(doc, indent=2, sort_keys=True) + "\n").encode("utf-8"))
    else:
        _write_secret_file(settings.credential_file, (token + "\n").encode("ascii"))


def credential_protection(settings: TruckLogSettings) -> str:
    """'dpapi-LocalMachine', 'dpapi-CurrentUser', 'file', 'missing' or 'unreadable' (no decryption)."""
    if settings.credential_format != "dpapi":
        return "file" if settings.credential_file.is_file() else "missing"
    try:
        doc = json.loads(settings.credential_file.read_text(encoding="utf-8"))
        return str(doc.get("protection") or "unknown")
    except FileNotFoundError:
        return "missing"
    except (OSError, ValueError):
        return "unreadable"


def load_token(settings: TruckLogSettings) -> str:
    path = settings.credential_file
    try:
        if not path.is_file():
            raise WatcherError(f"Truck Log credential not found: {path}. Run SETUP-TRUCK-LOG-UPLOAD.cmd as Administrator")
        if settings.credential_format == "dpapi":
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
                if doc.get("format") != CREDENTIAL_FORMAT:
                    raise ValueError("format")
                blob = base64.b64decode(doc["data"], validate=True)
            except (ValueError, KeyError, TypeError) as e:
                raise WatcherError(f"Truck Log credential file is not a DPAPI credential: {path}") from e
            token = _dpapi(blob, False, False).decode("ascii", "replace").strip()
        else:
            token = path.read_text(encoding="ascii", errors="replace").strip()
    except PermissionError as e:
        raise WatcherError(f"Truck Log credential {path} is readable only by SYSTEM and Administrators; "
                           "run this from an elevated (Run as administrator) prompt") from e
    if not TOKEN_PATTERN.match(token):
        raise WatcherError("Stored Truck Log credential is malformed; run SETUP-TRUCK-LOG-UPLOAD.cmd again")
    return token


def migrate_credential(settings: TruckLogSettings) -> str:
    """Re-seal a CurrentUser DPAPI credential with LocalMachine scope so the LocalSystem service can read it.

    Must run as the Windows user who originally stored it (that user's DPAPI key decrypts it).
    """
    prot = credential_protection(settings)
    if prot == "missing":
        raise WatcherError(f"No credential at {settings.credential_file}; run SETUP-TRUCK-LOG-UPLOAD.cmd as Administrator")
    token = load_token(settings)  # raises if this user cannot decrypt it
    if prot != "dpapi-LocalMachine" or settings.credential_format != "dpapi":
        store_token(settings, token, scope="LocalMachine")
    else:
        protect_credential_acl(settings.credential_file)
    if load_token(settings) != token:
        raise WatcherError("Re-sealed credential did not read back correctly")
    return token


# ---------------------------------------------------------------------------
# HTTP (stdlib urllib, redirects refused)
# ---------------------------------------------------------------------------

class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401 - urllib API
        return None  # urllib then raises HTTPError(3xx); the token is never re-sent elsewhere


@dataclass
class HttpResult:
    status: int            # 0 = network/TLS error (no HTTP response)
    body: bytes = b""
    error: str = ""


def http_request(method: str, url: str, *, headers: dict[str, str], body: Optional[bytes],
                 timeout: float, use_system_proxy: bool = False) -> HttpResult:
    handlers: list[Any] = [_RefuseRedirects(), urllib.request.HTTPSHandler(context=ssl.create_default_context())]
    if not use_system_proxy:
        handlers.append(urllib.request.ProxyHandler({}))
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with opener.open(req, timeout=timeout) as resp:
            return HttpResult(resp.status, resp.read(1024 * 1024))
    except urllib.error.HTTPError as e:
        try:
            data = e.read(64 * 1024)
        except Exception:
            data = b""
        return HttpResult(e.code, data, f"HTTP {e.code}")
    except (urllib.error.URLError, OSError, ssl.SSLError, ValueError) as e:
        reason = getattr(e, "reason", e)
        return HttpResult(0, b"", redact(f"{type(e).__name__}: {reason}")[:300])


def server_message(result: HttpResult) -> str:
    msg = ""
    try:
        doc = json.loads(result.body.decode("utf-8", "replace") or "{}")
        m = doc.get("message") if isinstance(doc, dict) else None
        msg = "; ".join(map(str, m)) if isinstance(m, list) else str(m or "")
    except ValueError:
        msg = result.body.decode("utf-8", "replace")[:300]
    return redact(f"HTTP {result.status}{': ' + msg if msg else ''}" if result.status else result.error)[:500]


# 4xx answers that describe THIS request (validation, conflict, size, type): never retried.
PERMANENT_STATUSES = {400, 409, 410, 411, 413, 415, 422}


def classify_result(result: HttpResult) -> str:
    """Return 'sent', 'permanent' or 'retry'."""
    if 200 <= result.status < 300:
        try:
            doc = json.loads(result.body.decode("utf-8"))
        except ValueError:
            return "retry"
        return "sent" if isinstance(doc, dict) and doc.get("accepted") is True else "retry"
    if result.status in PERMANENT_STATUSES:
        return "permanent"
    # 0 network/TLS, 3xx redirect refused (fix api_base), 401/403 credential, 404 endpoint
    # missing, 408/425/429 and 5xx: the slip itself is fine, so keep it and retry later.
    return "retry"


# ---------------------------------------------------------------------------
# Durable upload outbox
# ---------------------------------------------------------------------------

class Outbox:
    """On-disk queue: <state>/outbox/{pending,sent,failed}/<captureId>.json.

    Entries are written before any network call and survive restarts. A local
    PDF is never deleted or moved because of an upload result.
    """

    def __init__(self, root: Path, settings: TruckLogSettings, token_provider: Callable[[], str],
                 log: Callable[[str, str], None], *, http: Callable[..., HttpResult] = http_request,
                 clock: Callable[[], float] = time.time):
        self.root = root
        self.pending = root / "pending"
        self.sent = root / "sent"
        self.failed = root / "failed"
        self.s = settings
        self.token_provider = token_provider
        self.log = log
        self.http = http
        self.clock = clock
        self.wake = threading.Event()
        self._lock = threading.Lock()

    def prepare(self) -> None:
        for d in (self.pending, self.sent, self.failed):
            d.mkdir(parents=True, exist_ok=True)

    def enqueue(self, *, capture_id: str, metadata: dict[str, Any], pdf_path: Path, sha256: str) -> Path:
        validate_packing_slip_metadata(metadata)
        if metadata["clientReportedSha256"] != sha256:
            raise WatcherError("Outbox entry hash does not match metadata")
        entry = {
            "version": 1,
            "captureId": capture_id,
            "idempotencyKey": idempotency_key_for(capture_id),
            "metadata": metadata,
            "pdfPath": str(pdf_path),
            "sha256": sha256,
            "verified": True,
            "enqueuedAt": iso_utc(),
            "attempts": 0,
            "nextAttemptAt": 0,
            "lastError": None,
        }
        self.prepare()
        target = self.pending / f"{capture_id}.json"
        write_json_atomic(target, entry)
        self.wake.set()
        return target

    def counts(self) -> dict[str, int]:
        return {name: len(list(d.glob("*.json"))) if d.is_dir() else 0
                for name, d in (("pending", self.pending), ("sent", self.sent), ("failed", self.failed))}

    def _backoff(self, attempts: int) -> float:
        base = min(self.s.retry_max_seconds, self.s.retry_initial_seconds * (2 ** max(0, attempts - 1)))
        return base * random.uniform(0.9, 1.1)

    def _finish(self, path: Path, entry: dict[str, Any], folder: Path) -> None:
        write_json_atomic(folder / path.name, entry)
        path.unlink()

    def process_due(self, limit: int = 25) -> dict[str, int]:
        """Try due entries in age order. Stops early when Truck Log looks unreachable."""
        out = {"sent": 0, "failed": 0, "retry": 0}
        with self._lock:
            if not self.pending.is_dir():
                return out
            now = self.clock()
            paths = sorted(self.pending.glob("*.json"), key=lambda p: p.stat().st_mtime)
            for path in paths:
                if sum(out.values()) >= limit:
                    break
                try:
                    entry = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, ValueError) as e:
                    self.log("UPLOAD-FAIL", f"{path.name}: unreadable outbox entry ({type(e).__name__}); moved to failed")
                    try:
                        os.replace(path, self.failed / path.name)
                    except OSError:
                        pass
                    out["failed"] += 1
                    continue
                if float(entry.get("nextAttemptAt") or 0) > now:
                    continue
                verdict = self._attempt(path, entry)
                out[verdict] += 1
                if verdict == "retry" and entry.get("_stop_round"):
                    break
        return out

    def _permanent(self, path: Path, entry: dict[str, Any], message: str) -> None:
        entry["lastError"] = message
        entry["failedAt"] = iso_utc()
        self._finish(path, entry, self.failed)
        md = entry.get("metadata", {})
        line = "\t".join([iso_utc(), str(md.get("route", "")), str(md.get("sapDocumentId", "")),
                          str(entry.get("pdfPath", "")), message.replace("\t", " ").replace("\n", " ")])
        with (self.root / "UPLOAD-FAILED.txt").open("a", encoding="utf-8") as f:
            f.write(line + "\n")
        self.log("UPLOAD-FAIL", f"{md.get('route')} delivery {md.get('sapDocumentId')}: {message}. "
                                f"Local PDF kept: {entry.get('pdfPath')}. Listed in {self.root / 'UPLOAD-FAILED.txt'}")

    def _attempt(self, path: Path, entry: dict[str, Any]) -> str:
        md = entry.get("metadata") or {}
        pdf = Path(entry.get("pdfPath", ""))
        # Never send anything that is not exactly the verified, filed PDF.
        try:
            if entry.get("verified") is not True:
                raise WatcherError("entry is not marked verified")
            validate_packing_slip_metadata(md)
            data = pdf.read_bytes()
            if len(data) > SERVER_MAX_PDF_BYTES:
                raise WatcherError("PDF is larger than Truck Log's 25 MiB limit")
            digest = hashlib.sha256(data).hexdigest()
            if digest != entry.get("sha256") or digest != md.get("clientReportedSha256"):
                raise WatcherError("filed PDF changed after verification (SHA-256 mismatch)")
            if not IDEMPOTENCY_KEY_PATTERN.match(str(entry.get("idempotencyKey", ""))):
                raise WatcherError("invalid idempotency key")
        except FileNotFoundError:
            self._permanent(path, entry, f"Local PDF no longer exists: {pdf}")
            return "failed"
        except (WatcherError, OSError) as e:
            self._permanent(path, entry, f"Not uploaded: {redact(e)}")
            return "failed"
        try:
            token = self.token_provider()
        except WatcherError as e:
            return self._retry(path, entry, f"credential unavailable: {redact(e)}", stop=True)
        content_type, body = build_multipart(md, data, pdf.name)
        headers = {
            "Authorization": f"Bearer {token}",
            "X-Idempotency-Key": entry["idempotencyKey"],
            "Content-Type": content_type,
            "Accept": "application/json",
            "User-Agent": WATCHER_VERSION,
        }
        entry["attempts"] = int(entry.get("attempts") or 0) + 1
        entry["lastAttemptAt"] = iso_utc()
        result = self.http("POST", self.s.api_base + UPLOAD_PATH, headers=headers, body=body,
                           timeout=self.s.timeout_seconds, use_system_proxy=self.s.use_system_proxy)
        verdict = classify_result(result)
        if verdict == "sent":
            try:
                entry["response"] = json.loads(result.body.decode("utf-8"))
            except ValueError:
                entry["response"] = None
            entry["sentAt"] = iso_utc()
            entry["lastError"] = None
            self._finish(path, entry, self.sent)
            resp = entry["response"] or {}
            level = "UPLOAD" if resp.get("validationStatus") == "VALIDATED" else "UPLOAD-WARN"
            self.log(level, f"{md.get('route')} delivery {md.get('sapDocumentId')} -> Truck Log document "
                            f"{resp.get('documentId')} ({resp.get('validationStatus')}"
                            f"{', duplicate' if resp.get('duplicate') else ''})")
            return "sent"
        message = server_message(result)
        if verdict == "permanent":
            self._permanent(path, entry, message)
            return "failed"
        if 300 <= result.status < 400:
            message += " (redirect refused; check [truck_log] api_base)"
        elif result.status in (401, 403):
            message += " (credential rejected or lacks documents:upload; re-run SETUP-TRUCK-LOG-UPLOAD.cmd)"
        return self._retry(path, entry, message, stop=(result.status == 0 or result.status >= 500
                                                       or result.status in (401, 403, 404, 429)
                                                       or 300 <= result.status < 400))

    def _retry(self, path: Path, entry: dict[str, Any], message: str, *, stop: bool) -> str:
        delay = self._backoff(int(entry.get("attempts") or 1))
        entry["lastError"] = redact(message)
        entry["nextAttemptAt"] = self.clock() + delay
        write_json_atomic(path, entry)
        md = entry.get("metadata", {})
        self.log("UPLOAD-RETRY", f"{md.get('route')} delivery {md.get('sapDocumentId')}: {entry['lastError']}; "
                                 f"attempt {entry.get('attempts')}, next in {int(delay)}s")
        entry["_stop_round"] = stop
        return "retry"

    def requeue_failed(self) -> int:
        self.prepare()
        n = 0
        for path in sorted(self.failed.glob("*.json")):
            try:
                entry = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            entry["nextAttemptAt"] = 0
            entry.pop("failedAt", None)
            write_json_atomic(self.pending / path.name, entry)
            path.unlink()
            n += 1
        self.wake.set()
        return n


def idempotency_key_for(capture_id: str) -> str:
    """Stable per capture: retries and restarts reuse the same key."""
    key = f"sapw-{capture_id}"
    if not IDEMPOTENCY_KEY_PATTERN.match(key):
        raise WatcherError("capture id cannot form a valid idempotency key")
    return key


class UploadWorker(threading.Thread):
    def __init__(self, outbox: Outbox, log: Callable[[str, str], None], idle_seconds: float = 5.0):
        super().__init__(name="truck-log-upload", daemon=True)
        self.outbox = outbox
        self.log = log
        self.idle = idle_seconds
        self.stop_event = threading.Event()

    def run(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.outbox.process_due()
            except Exception as e:  # keep the capture loop alive whatever happens here
                self.log("UPLOAD-RETRY", f"upload worker error {type(e).__name__}: {redact(e)}")
            self.outbox.wake.wait(self.idle)
            self.outbox.wake.clear()

    def stop(self) -> None:
        self.stop_event.set()
        self.outbox.wake.set()


# ---------------------------------------------------------------------------
# Locks and older-watcher detection
# ---------------------------------------------------------------------------

class FileLock:
    """System-wide per-host lock; compatible with Windows/POSIX, not original V3 lock."""
    def __init__(self, filename: Path):
        self.filename = filename
        self.f = None

    def __enter__(self):
        self.filename.parent.mkdir(parents=True, exist_ok=True)
        self.f = self.filename.open("a+b")
        self.f.seek(0)
        self.f.write(b"0")
        self.f.flush()
        self.f.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, IOError) as e:
            self.f.close()
            raise WatcherError("Another restored SAP watcher process holds the lock; do not run twice") from e
        return self

    def __exit__(self, *_args):
        if self.f:
            self.f.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(self.f.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.f.fileno(), fcntl.LOCK_UN)
            finally:
                self.f.close()


WATCHER_COMMAND_MARKERS = ("truck_log_print_server", "truck-log-sap-capture", "sap_capture_watcher.py")


def conflicting_watchers(processes: list[dict[str, Any]], own_pid: int, parent_pid: int) -> list[dict[str, Any]]:
    """Python processes that look like SAP watchers and are not this process or its ancestors.

    A Windows venv python.exe is a launcher that starts the real interpreter as a
    child with the same command line, so the parent (and any further python
    ancestors) must be ignored.
    """
    by_pid: dict[int, dict[str, Any]] = {}
    for p in processes:
        if isinstance(p, dict):
            try:
                by_pid[int(p.get("ProcessId") or 0)] = p
            except (TypeError, ValueError):
                continue
    exempt = {own_pid, parent_pid}
    pid = own_pid if own_pid in by_pid else parent_pid
    seen: set[int] = set()
    while pid in by_pid and pid not in seen and len(seen) < 32:  # walk ancestors; PID reuse cannot loop
        seen.add(pid)
        try:
            ppid = int(by_pid[pid].get("ParentProcessId") or 0)
        except (TypeError, ValueError):
            break
        if ppid <= 0:
            break
        exempt.add(ppid)
        pid = ppid
    found = []
    for pid, p in by_pid.items():
        if pid in exempt:
            continue
        cmd = (p.get("CommandLine") or "").lower()
        if any(marker in cmd for marker in WATCHER_COMMAND_MARKERS):
            found.append(p)
    return found


def list_python_processes() -> list[dict[str, Any]]:
    ps = r"""$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter "name='python.exe' or name='pythonw.exe'" | Select-Object ProcessId,ParentProcessId,CommandLine) | ConvertTo-Json -Compress"""
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=18, text=True)
    if result.returncode != 0:
        raise WatcherError("Cannot inspect older Python watchers; not starting (fail-closed)")
    value = result.stdout.strip()
    if not value:
        return []
    try:
        all_proc = json.loads(value)
    except ValueError as e:
        raise WatcherError("Cannot parse existing process inventory; not starting") from e
    if isinstance(all_proc, dict):
        all_proc = [all_proc]
    return [p for p in all_proc if isinstance(p, dict)]


def check_legacy_watcher(lister: Callable[[], list[dict[str, Any]]] = list_python_processes) -> None:
    """Don't run restored watcher concurrently with prior SAP V2/V3 Python watcher."""
    if os.name != "nt" and lister is list_python_processes:
        return
    if conflicting_watchers(lister(), os.getpid(), os.getppid()):
        raise WatcherError("Older or duplicate SAP watcher appears to be active. Stop it gracefully before starting this implementation.")


# ---------------------------------------------------------------------------
# Watcher
# ---------------------------------------------------------------------------

@dataclass
class Observation:
    size: int
    mtime_ns: int
    since: float
    review_logged: bool = False
    snapshot: Optional[Path] = None
    snapshot_sha: str = ""
    snapshot_size: int = 0

    @property
    def signature(self) -> tuple[int, int]:
        return self.size, self.mtime_ns


ExtractResult = Union[str, Iterable[tuple[str, str]]]


class CaptureWorker(threading.Thread):
    """One FIFO processing owner; slow extraction/rendering never delays staging capture."""
    def __init__(self, watcher: "Watcher"):
        super().__init__(name="capture-processing", daemon=True)
        self.watcher = watcher

    def run(self) -> None:
        w = self.watcher
        while not w._processing_stop.is_set():
            w._capture_wake.clear()
            try:
                w.process_pending()
            except Exception as e:
                w.log("REVIEW", f"Capture worker error {type(e).__name__}: {redact(e)}")
            w._capture_wake.wait(.5)

    def stop(self) -> None:
        self.watcher._processing_stop.set()
        self.watcher._capture_wake.set()


class Watcher:
    def __init__(self, config: Settings, *, extract_text: Callable[[Path, bool], ExtractResult] = pdf_text_layers,
                 submit_print: Optional[Callable[[Path, str], None]] = None,
                 outbox: Optional[Outbox] = None, routes: Optional[Iterable[Route]] = None,
                 config_client: Optional[RouteConfigClient] = None,
                 stop_file: Optional[Path] = None, run_id: Optional[str] = None):
        self.c = config
        self.extract_text = extract_text
        self.submit_print = submit_print or self._submit_pdf
        self.observed: dict[str, Observation] = {}
        self.run_id = run_id or str(uuid.uuid4())
        self.stop_file = stop_file
        self._log_lock = threading.Lock()
        self._token: Optional[str] = None
        self.outbox = outbox
        if self.outbox is None and config.truck_log.configured:
            self.outbox = Outbox(config.state_dir / "outbox", config.truck_log, self._get_token, self.log)
        self.config_client = config_client
        if self.config_client is None and routes is None:
            self.config_client = RouteConfigClient(config.truck_log, config.state_dir, self._get_token, self.log,
                                                   on_auth_failure=self._forget_token)
        # Effective route settings. Fixed routes (tests) bypass Truck Log entirely.
        self.route_doc: Optional[dict[str, Any]] = None
        self.route_source = "FIXED" if routes is not None else "NONE"
        self.routes: tuple[Route, ...] = tuple(routes) if routes is not None else ()
        self.stale_since_off: dict[int, tuple[int, int]] = {}
        self.stale_reasons: dict[int, str] = {}
        self._capture_lock = threading.Lock()
        self._capture_wake = threading.Event()
        self._processing_stop = threading.Event()
        self._queue_full_logged = False
        self.capture_queue = config.state_dir / "capture-queue"
        self.provenance_file = config.state_dir / "capture-provenance.json"

    # -- credential ------------------------------------------------------------
    def _get_token(self) -> str:
        if self._token is None:
            self._token = load_token(self.c.truck_log)  # raises; retried on the next use
        return self._token

    def _forget_token(self) -> None:
        self._token = None  # re-read after SETUP-TRUCK-LOG-UPLOAD.cmd replaced the credential

    # -- logging ---------------------------------------------------------------
    def log(self, level: str, message: str) -> None:
        line = redact(f"{iso_utc()} [{level}] {message}")
        with self._log_lock:
            try:
                print(line, flush=True)
            except (OSError, ValueError):
                pass  # no console (service)
            self.c.state_dir.mkdir(parents=True, exist_ok=True)
            path = self.c.state_dir / "watcher.log"
            rotate_log(path)
            with path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")

    def prepare_dirs(self) -> None:
        self.c.state_dir.mkdir(parents=True, exist_ok=True)
        (self.c.state_dir / "journal").mkdir(parents=True, exist_ok=True)
        (self.c.state_dir / "snapshots").mkdir(parents=True, exist_ok=True)
        self.capture_queue.mkdir(parents=True, exist_ok=True)
        (self.capture_queue / "review").mkdir(parents=True, exist_ok=True)
        if self.outbox:
            self.outbox.prepare()
        for r in (self.routes or self.c.route_paths):
            for folder in [r.capture_file.parent, r.incoming, r.ready, r.needs_review]:
                folder.mkdir(parents=True, exist_ok=True)

    # -- route settings --------------------------------------------------------
    def apply_route_config(self, doc: dict[str, Any], source: str) -> bool:
        """Switch to a validated document. Only called between captures. Returns True if anything changed."""
        routes, warnings = build_routes(doc, self.c.route_paths)
        old_doc, old = self.route_doc, {r.number: r for r in self.routes}
        version, by = doc.get("version"), doc.get("updatedBy") or "unknown"
        changed = old_doc is None or routes != self.routes or old_doc.get("version") != version
        self.route_doc, self.routes, self.route_source = doc, routes, source
        if not changed:
            return False
        if source == "SAFE_DEFAULT":
            self.log("CONFIG", "no Truck Log route settings and no cache yet: SAFE DEFAULT, every route TEST "
                               "(never prints), upload off")
        else:
            back = (old_doc is not None and isinstance(old_doc.get("version"), int)
                    and isinstance(version, int) and 0 < version < old_doc["version"])
            self.log("CONFIG", f"route settings version {version} by {by} at {doc.get('updatedAt') or '?'} applied "
                               f"(from {source}){' - version went BACKWARDS, check Truck Log' if back else ''}")
        for r in routes:
            prev = old.get(r.number)
            tag = f"(version {version} by {by})"
            if prev is None:
                self.log("CONFIG", f"route {r.number} {r.name}: {r.mode}, upload {'on' if r.upload_enabled else 'off'}"
                                   f"{', printer ' + r.printer if r.live else ''}, queue {r.queue_name} {tag}")
                continue
            if prev.mode != r.mode:
                self.log("CONFIG", f"route {r.number} {r.name}: {prev.mode} -> {r.mode} {tag}")
            if prev.upload_enabled != r.upload_enabled:
                self.log("CONFIG", f"route {r.number} {r.name}: upload {'on' if prev.upload_enabled else 'off'} -> "
                                   f"{'on' if r.upload_enabled else 'off'} {tag}")
            if prev.printer != r.printer:
                self.log("CONFIG", f"route {r.number} {r.name}: printer {prev.printer or '(none)'} -> "
                                   f"{r.printer or '(none)'} {tag}")
            if (prev.name, prev.queue_name) != (r.name, r.queue_name):
                self.log("CONFIG", f"route {r.number}: name/queue {prev.name}/{prev.queue_name} -> "
                                   f"{r.name}/{r.queue_name} {tag}")
            if prev.enabled and not r.enabled:
                obs = self.observed.pop(str(r.capture_file), None)
                if obs and obs.snapshot:
                    if self._is_same_job_growing(r, obs):
                        self._discard_snapshot(obs)
                    else:
                        self.log("REVIEW", f"Route disabled with an unqueued overwrite snapshot; preserved for manual review: {obs.snapshot}")
                self.stale_since_off.pop(r.number, None)
                self.stale_reasons.pop(r.number, None)
            elif not prev.enabled and r.enabled:
                # A file left in staging while OFF is old: never print it after switching on.
                try:
                    st = r.capture_file.stat()
                    self.stale_since_off[r.number] = (st.st_size, st.st_mtime_ns)
                    self.stale_reasons[r.number] = "Captured while this route was OFF in Truck Log; filed for review and not printed."
                except OSError:
                    self.stale_since_off.pop(r.number, None)
        self._save_provenance()
        for w in warnings:
            self.log("WARN", w)
        return True

    def initial_route_config(self) -> None:
        """Start-up: Truck Log if reachable, else the cached document, else the safe default."""
        client = self.config_client
        if client is None:
            return
        cached = client.load_cache()
        res = client.refresh(cached["document"] if cached else None)
        doc = client.take_pending()
        if doc is not None:
            self.apply_route_config(doc, "TRUCK_LOG")
        elif cached:
            self.apply_route_config(cached["document"], "CACHE" if res.outcome != "not_modified" else "TRUCK_LOG")
        else:
            self.apply_route_config(safe_default_document(), "SAFE_DEFAULT")

    def apply_pending_config(self) -> None:
        if self.config_client is not None:
            doc = self.config_client.take_pending()
            if doc is not None:
                self.apply_route_config(doc, "TRUCK_LOG")

    def stop_requested(self) -> bool:
        if not self.stop_file:
            return False
        try:
            return self.stop_file.read_text(encoding="utf-8-sig").strip() == self.run_id
        except OSError:
            return False

    # -- processing ------------------------------------------------------------
    def _journal(self, record: dict[str, Any]) -> None:
        write_json_atomic(self.c.state_dir / "journal" / (record["id"] + ".json"), record)

    def _submit_pdf(self, path: Path, printer: str) -> None:
        if not self.c.sumatra.is_file():
            raise WatcherError(f"SumatraPDF not found: {self.c.sumatra}")
        # Submission only; does NOT prove paper physically emerged.
        if self._processing_stop.is_set():
            raise WatcherError("Service stopping; print submission not started")
        # No shell and no pipe buffers: cancellation/timeout kills only this renderer.
        with subprocess.Popen([str(self.c.sumatra), "-print-to", printer, "-silent", str(path)],
                              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL) as proc:
            deadline = time.monotonic() + 120
            while proc.poll() is None:
                if self._processing_stop.wait(.2) or time.monotonic() >= deadline:
                    proc.kill()
                    proc.wait(timeout=5)
                    raise WatcherError("Print renderer stopped/timed out; outcome uncertain, do not automatically retry")
            if proc.returncode != 0:
                raise WatcherError(f"SumatraPDF submission exit={proc.returncode}")

    def _place(self, src: Path, folder: Path) -> Path:
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / src.name
        if dest.exists():
            raise WatcherError(f"Destination already exists, refused overwrite: {dest}")
        src.rename(dest)
        return dest

    def verify(self, path: Path) -> Verification:
        result = self.extract_text(path, self.c.ocr_enabled)
        layers = [("PYPDF_TEXT", result)] if isinstance(result, str) else result
        return verify_layers(layers)

    def _queue_upload(self, r: Route, record: dict[str, Any], verification: Verification,
                      print_status: str, output_printer: str, print_error: Optional[str],
                      review_reason: Optional[str]) -> None:
        if not r.upload_enabled:
            record["upload"] = "OFF_FOR_ROUTE"
            return
        if not self.outbox:
            record["upload"] = "NOT_QUEUED: [truck_log] api_base not set"
            return
        try:
            capture_id = record["id"]
            md = build_packing_slip_metadata(
                source_capture_id=f"{self.c.truck_log.source_host or 'print-pc'}.route{r.number}.{capture_id}",
                verification=verification, route=r, output_printer=output_printer,
                captured_at=record["captured_at"], print_status=print_status, sha256=record["sha256"],
                print_error=print_error, review_reason=review_reason)
            self.outbox.enqueue(capture_id=capture_id, metadata=md, pdf_path=Path(record["stored_file"]),
                                sha256=record["sha256"])
            record["upload"] = "QUEUED"
        except Exception as e:  # filing locally always wins over upload problems
            record["upload"] = f"NOT_QUEUED: {type(e).__name__}: {redact(e)[:200]}"
            self.log("UPLOAD-FAIL", f"route{r.number}: could not queue upload: {redact(e)}")

    def _accept(self, r: Route, src: Optional[Path] = None,
                 recovered_reason: Optional[str] = None,
                 stale_reason: Optional[str] = None) -> Optional[dict[str, Any]]:
        recovered = src is not None
        src = src or r.capture_file
        uid = uuid.uuid4().hex
        now = dt.datetime.now(dt.timezone.utc)
        filename = f"route{r.number}-{now.strftime('%Y%m%dT%H%M%SZ')}-{uid}.pdf"
        incoming = r.incoming / filename
        record: dict[str, Any] = {"id": uid, "route": r.number, "route_name": r.name,
                                  "started_at": iso_utc(), "captured_at": iso_utc_ms(now),
                                  "status": "ACCEPTED", "mode": r.mode,
                                  "upload_enabled": r.upload_enabled,
                                  "route_config_version": (self.route_doc or {}).get("version"),
                                  "printer": r.printer if r.live else TEST_MODE_PRINTER,
                                  "capture_file": str(src), "incoming_file": str(incoming),
                                  "worker_run_id": self.run_id}
        if recovered:
            record["recovered_reason"] = recovered_reason
        if stale_reason:
            record["stale_reason"] = stale_reason
        # An atomic rename releases the fixed-name spool destination for the next job.
        try:
            if recovered:
                r.incoming.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(incoming))
            else:
                src.rename(incoming)
        except OSError as e:
            self.log("RETRY", f"route{r.number} capture still locked/moving; will retry. {type(e).__name__}")
            return None
        self._journal(record)
        self.log("CAPTURE", f"route{r.number}: durably filed {incoming.name} ({r.mode}); awaiting processing")
        return record

    def _process(self, r: Route, src: Optional[Path] = None,
                 recovered_reason: Optional[str] = None,
                 stale_reason: Optional[str] = None) -> Optional[dict[str, Any]]:
        """Synchronous single-file helper; the running scanner uses the durable queue."""
        record = self._accept(r, src, recovered_reason, stale_reason)
        return self._process_record(r, record) if record else None

    def _process_record(self, r: Route, record: dict[str, Any]) -> dict[str, Any]:
        incoming = Path(record["incoming_file"])
        recovered = bool(record.get("recovered_reason"))
        stale_reason = record.get("stale_reason")
        self.log("INFO", f"route{r.number}: processing {incoming.name} ({r.mode}); checking PDF")
        verification = Verification(False)
        print_status, output_printer, print_error = "SKIPPED", TEST_MODE_PRINTER, None
        review_reason = None
        try:
            record["sha256"] = sha256_file(incoming)
            if record.get("capture_sha256") and record["sha256"] != record["capture_sha256"]:
                raise WatcherError("Queued PDF changed after capture; printing refused")
            validate_pdf_file(incoming, self.c.max_pdf_bytes)
            verification = self.verify(incoming)
            if not verification.ok:
                raise WatcherError(verification.reason)
            detail = verification.delivery_number
            record["delivery_number"] = detail
            record["detection_method"] = verification.method
            target = r.ready
            if recovered:
                record["status"] = "RECOVERED_AFTER_OVERWRITE_NOT_PRINTED"
                output_printer = RECOVERED_PRINTER
                review_reason = ("Recovered by the SAP watcher after the route staging capture.pdf was "
                                 "replaced before it could be filed; it was not printed.")
                target = r.needs_review
            elif stale_reason:
                record["status"] = ("CAPTURED_WHILE_ROUTE_OFF_NOT_PRINTED" if "while this route was OFF" in stale_reason
                                    else "CAPTURE_PROVENANCE_REVIEW_NOT_PRINTED")
                output_printer = CAPTURED_WHILE_OFF_PRINTER
                review_reason = stale_reason
                target = r.needs_review
            elif not r.live:
                # TEST: verify, file and (if enabled) upload; never paper.
                record["status"] = "TEST_MODE_READY_NOT_PRINTED"
            else:
                output_printer = r.printer
                # Write BEFORE submission. A crash must never auto-reprint this job.
                record["status"] = "PRINT_SUBMISSION_PENDING_DO_NOT_RETRY_AUTOMATICALLY"
                self._journal(record)
                # Extraction/OCR and the durable intent write may have been slow. Re-check
                # current authorization at the last handoff before starting the renderer.
                if not self._live_authorized(r):
                    record["status"] = "CAPTURE_PROVENANCE_REVIEW_NOT_PRINTED"
                    review_reason = "LIVE print authorization changed before submission; review required, not printed."
                    record["stale_reason"] = review_reason
                    target, output_printer = r.needs_review, CAPTURED_WHILE_OFF_PRINTER
                else:
                    try:
                        self.submit_print(incoming, r.printer)
                    except Exception as e:
                        print_status, print_error = "FAILED", f"{type(e).__name__}: {str(e)[:500]}"
                        raise
                    print_status = "PRINTED"  # spooler submission accepted; paper not verified
                    record["status"] = "PRINT_SUBMITTED_PAPER_UNVERIFIED"
            dest = self._place(incoming, target)
            record["stored_file"] = str(dest)
            record["completed_at"] = iso_utc()
            self._queue_upload(r, record, verification, print_status, output_printer, print_error, review_reason)
            self._journal(record)
            to_review = recovered or bool(record.get("stale_reason"))
            self.log("PASS" if not recovered else "RECOVERED",
                     f"route{r.number}: delivery {detail} ({verification.method}) -> "
                     f"{'NeedsReview' if to_review else 'Ready'}; {record['status']}"
                     f"{'; upload queued' if record.get('upload') == 'QUEUED' else ''}")
        except Exception as e:
            if record["status"] == "PRINT_SUBMISSION_PENDING_DO_NOT_RETRY_AUTOMATICALLY":
                record["status"] = "UNCERTAIN_PRINT_DO_NOT_AUTO_RETRY"
            elif record["status"] in ("ACCEPTED",):
                record["status"] = "NEEDS_REVIEW_NO_PRINT"
            record["error"] = redact(f"{type(e).__name__}: {str(e)[:260]}")
            try:
                dest = self._place(incoming, r.needs_review)
                record["stored_file"] = str(dest)
            except Exception as move_error:
                record["error"] += f"; move failed: {type(move_error).__name__}"
                record["stored_file"] = str(incoming)
            record["completed_at"] = iso_utc()
            if verification.ok and "sha256" in record:
                # A verified slip whose printing failed is still a real packing slip.
                if recovered and not review_reason:
                    review_reason = "Recovered by the SAP watcher after a staging overwrite; it was not printed."
                self._queue_upload(r, record, verification, print_status,
                                   output_printer if not recovered else RECOVERED_PRINTER,
                                   print_error, review_reason)
            self._journal(record)
            self.log("REVIEW", f"route{r.number}: {record['status']} {record['error']}")
        return record

    # -- durable capture queue (only the processing worker renders/extracts) -----

    def _save_provenance(self) -> None:
        write_json_atomic(self.provenance_file, {
            "version": 1, "routeModes": {str(r.number): r.mode for r in self.routes},
            "stale": {str(n): {"size": sig[0], "mtimeNs": sig[1],
                                "reason": self.stale_reasons.get(n, "Creation mode unknown; review required.")}
                      for n, sig in self.stale_since_off.items()}})

    def _decode_capture(self, entry: dict[str, Any]) -> tuple[Route, dict[str, Any]]:
        if entry.get("version") != 1:
            raise WatcherError("Unknown capture queue format")
        frozen, record = entry["route"], entry["record"]
        local = next(p for p in self.c.route_paths if p.number == frozen["number"])
        if record["route"] != local.number or not re.fullmatch(r"[0-9a-f]{32}", record["id"]):
            raise WatcherError("Invalid queued capture identity")
        incoming = Path(record["incoming_file"])
        if _norm(incoming.parent) != _norm(local.incoming) or incoming.suffix.lower() != ".pdf":
            raise WatcherError("Queued capture is outside its configured Incoming folder")
        if frozen["mode"] not in ROUTE_MODES or type(frozen["upload_enabled"]) is not bool:
            raise WatcherError("Invalid frozen capture mode")
        for key in ("name", "printer", "source_queue"):
            _plain_string(frozen[key], key, 0, 260)
        route = Route(local.number, frozen["name"], local.capture_file, local.incoming,
                      local.ready, local.needs_review, frozen["printer"], frozen["mode"],
                      frozen["upload_enabled"], frozen["source_queue"])
        return route, record

    def _enqueue_capture(self, r: Route, src: Optional[Path] = None,
                         recovered_reason: Optional[str] = None,
                         stale_reason: Optional[str] = None) -> Optional[dict[str, Any]]:
        with self._capture_lock:
            backlog = len(list(self.capture_queue.glob("*.json"))) + len(list(self.capture_queue.glob("*.active")))
            if backlog >= self.c.max_pending_captures:
                if not self._queue_full_logged:
                    self.log("QUEUE-FULL", "Capture queue limit reached: stop SAP capture submissions and investigate. "
                             "Existing files are retained; fixed staging destinations can be overwritten by SAP while full.")
                    self._queue_full_logged = True
                return None
            self._queue_full_logged = False
            record = self._accept(r, src, recovered_reason, stale_reason)
            if record is None:
                return None
            # Fast bounded hashing catches a staging replacement at the final rename. No PDF
            # parsing, OCR, printer or HTTP calls run in this capture thread.
            record["capture_sha256"] = sha256_file(Path(record["incoming_file"]))
            frozen = {k: v for k, v in asdict(r).items() if not isinstance(v, Path)}
            name = f"{time.time_ns():020d}-{record['id']}.json"
            write_json_atomic(self.capture_queue / name, {"version": 1, "route": frozen, "record": record})
            self._capture_wake.set()
            return record

    def _live_authorized(self, frozen: Route) -> bool:
        current = next((route for route in self.routes if route.number == frozen.number), None)
        return current is not None and current.live and current.printer == frozen.printer

    def process_pending(self, limit: int = 500) -> int:
        """Process durable accepted captures in FIFO order; never replay an active entry."""
        count = 0
        for _ in range(limit):
            if self._processing_stop.is_set():
                break
            with self._capture_lock:
                paths = sorted(self.capture_queue.glob("*.json"))
                if not paths:
                    break
                path = paths[0]
                active = path.with_suffix(".active")
                os.replace(path, active)  # persisted before extraction or any print intent
            try:
                r, record = self._decode_capture(json.loads(active.read_text(encoding="utf-8")))
                if r.live and not self._live_authorized(r):
                    record["stale_reason"] = "LIVE print authorization changed while the capture was queued; review required, not printed."
                self._process_record(r, record)
                active.unlink()
            except Exception as e:
                # Retain active state for manual recovery; never retry a possible print.
                self.log("REVIEW", f"Capture processing interrupted: {type(e).__name__}: {redact(e)}; "
                         f"{active.name} is retained and will not be automatically replayed")
            count += 1
        return count

    def reconcile_startup(self) -> None:
        """Before any LIVE work: quarantine unknown staged/active files; resume only READY captures."""
        try:
            saved = json.loads(self.provenance_file.read_text(encoding="utf-8"))
            for n, item in saved.get("stale", {}).items():
                self.stale_since_off[int(n)] = (int(item["size"]), int(item["mtimeNs"]))
                self.stale_reasons[int(n)] = str(item["reason"])
        except (OSError, ValueError, KeyError, TypeError):
            pass  # Unknown provenance is quarantined below, never treated as printable.
        referenced: set[str] = set()
        for path in sorted(list(self.capture_queue.glob("*.json")) + list(self.capture_queue.glob("*.active"))):
            try:
                r, record = self._decode_capture(json.loads(path.read_text(encoding="utf-8")))
                incoming = Path(record["incoming_file"])
                if path.suffix == ".json" and incoming.is_file():
                    referenced.add(_norm(incoming))
                    continue  # No renderer has ever owned this durable READY capture.
                if incoming.is_file():
                    record["stored_file"] = str(self._place(incoming, r.needs_review))
                record["status"] = "RESTART_REQUIRES_REVIEW_DO_NOT_REPRINT"
                record["error"] = "Processing was interrupted; inspect paper output before any manual retry."
                self._journal(record)
                self.log("REVIEW", f"Interrupted capture {record['id']}: no automatic reprint")
            except Exception as e:
                self.log("REVIEW", f"Invalid/interrupted capture queue entry {path.name}: {type(e).__name__}; manual review required")
            os.replace(path, self.capture_queue / "review" / path.name)
        for r in self.routes:
            # Existing staging content could have arrived while OFF or the service was down.
            # Metadata alone cannot prove LIVE provenance; do not print it automatically.
            try:
                stat = r.capture_file.stat()
                self.stale_since_off[r.number] = (stat.st_size, stat.st_mtime_ns)
                self.stale_reasons[r.number] = "Pre-existing capture at watcher startup; creation mode unknown. Review required; not printed."
            except FileNotFoundError:
                pass
            for incoming in r.incoming.glob("*.pdf"):
                if _norm(incoming) not in referenced:
                    dest = self._place(incoming, r.needs_review)
                    self.log("REVIEW", f"Unqueued Incoming capture moved to {dest}; never automatically printed")
        self._save_provenance()

    # -- staging-file observation (overwrite detection) ---------------------

    def _try_snapshot(self, r: Route, obs: Observation) -> None:
        """Copy a complete-looking staged PDF aside so an overwrite cannot silently lose it."""
        if obs.snapshot is not None:
            return
        try:
            with r.capture_file.open("rb") as f:
                head = f.read(8)
                f.seek(max(0, obs.size - 4096))
                if not looks_complete_pdf(head + b"\n" + f.read()):
                    return  # still being written; cheap check before copying
                f.seek(0)
                data = f.read(obs.size + 1)
        except OSError:
            return  # spooler may still hold it exclusively; try next poll
        if len(data) != obs.size or not looks_complete_pdf(data):
            return
        snap = self.c.state_dir / "snapshots" / f"route{r.number}-{uuid.uuid4().hex}.pdf"
        try:
            snap.parent.mkdir(parents=True, exist_ok=True)
            snap.write_bytes(data)
        except OSError as e:
            self.log("WARN", f"route{r.number}: could not write staging snapshot ({type(e).__name__})")
            return
        obs.snapshot, obs.snapshot_sha, obs.snapshot_size = snap, hashlib.sha256(data).hexdigest(), len(data)

    def _discard_snapshot(self, obs: Optional[Observation]) -> None:
        if obs and obs.snapshot:
            try:
                obs.snapshot.unlink()
            except OSError:
                pass
            obs.snapshot = None

    def _is_same_job_growing(self, r: Route, obs: Observation) -> bool:
        """True when the current file starts with the snapshot bytes (appended, not replaced)."""
        try:
            with r.capture_file.open("rb") as f:
                head = f.read(obs.snapshot_size)
        except OSError:
            return False
        return len(head) == obs.snapshot_size and hashlib.sha256(head).hexdigest() == obs.snapshot_sha

    def _recover(self, r: Route, obs: Observation, why: str) -> bool:
        if not obs.snapshot or not obs.snapshot.exists():
            return False
        self.log("OVERWRITE", f"route{r.number}: {why}. The earlier print was saved from a snapshot and "
                              "goes to NeedsReview (never printed automatically).")
        record = self._enqueue_capture(r, src=obs.snapshot, recovered_reason=why)
        if record is None:
            return False
        obs.snapshot = None
        return True

    def scan(self) -> int:
        processed = 0
        for r in self.routes:  # one immutable snapshot per scan: config changes apply between captures
            if not r.enabled:
                continue  # OFF: capture file not read
            key = str(r.capture_file)
            try:
                stat = r.capture_file.stat()
                if not r.capture_file.is_file():
                    continue
            except FileNotFoundError:
                obs = self.observed.get(key)
                if obs and obs.snapshot:
                    if self._recover(r, obs, "staging capture.pdf disappeared before it was filed"):
                        processed += 1
                        self.observed.pop(key, None)
                else:
                    self.observed.pop(key, None)
                continue
            sig = (stat.st_size, stat.st_mtime_ns)
            obs = self.observed.get(key)
            now = time.monotonic()
            if obs is None or obs.signature != sig:
                if obs is not None and obs.snapshot:
                    if self._is_same_job_growing(r, obs):
                        self._discard_snapshot(obs)
                    else:
                        if not self._recover(r, obs, "staging capture.pdf was replaced by a new print before it was filed"):
                            continue
                        processed += 1
                obs = Observation(stat.st_size, stat.st_mtime_ns, now)
                self.observed[key] = obs
                if self.c.max_pdf_bytes >= stat.st_size >= 20:
                    self._try_snapshot(r, obs)
                continue
            if stat.st_size < 20 or stat.st_size > self.c.max_pdf_bytes:
                if not obs.review_logged:
                    self.log("REVIEW", f"route{r.number}: staged PDF size {stat.st_size} out of bounds; not moving")
                    obs.review_logged = True
                continue
            self._try_snapshot(r, obs)
            if now - obs.since < self.c.settle_seconds:
                continue
            if obs.snapshot:
                try:
                    current = sha256_file(r.capture_file)
                except OSError:
                    continue
                if current != obs.snapshot_sha:
                    # Same size and timestamp but different bytes: replaced in place.
                    if self._recover(r, obs, "staging capture.pdf was replaced in place before it was filed"):
                        self.observed.pop(key, None)
                        processed += 1
                    continue
            # A malformed/incomplete PDF can still be moved into NeedsReview; it will never print.
            stale = self.stale_since_off.get(r.number)
            record = self._enqueue_capture(r, stale_reason=(
                self.stale_reasons.get(r.number, "Pre-existing capture has unknown creation mode; review required.")
                if stale is not None and stale == sig else None))
            if record:
                self.stale_since_off.pop(r.number, None)
                self.stale_reasons.pop(r.number, None)
                self._save_provenance()
                processed += 1
                if obs.snapshot and record.get("capture_sha256") == obs.snapshot_sha:
                    self._discard_snapshot(obs)
                    self.observed.pop(key, None)
                elif obs.snapshot:
                    if self._recover(r, obs, "staging capture.pdf changed between the final check and filing"):
                        self.observed.pop(key, None)
                    # A full queue must retain this observed snapshot: the replacement
                    # has been accepted, and a subsequent scan can still recover the old job.
                else:
                    self.observed.pop(key, None)
        return processed

    def run(self, once: bool = False, service: bool = False) -> None:
        check_legacy_watcher()
        self.c.state_dir.mkdir(parents=True, exist_ok=True)
        with FileLock(self.c.state_dir / "sap-capture.lock"):
            self.initial_route_config()
            self.prepare_dirs()
            self.reconcile_startup()
            self._processing_stop.clear()
            tl = self.c.truck_log
            self.log("START", f"run_id={self.run_id} host={socket.gethostname()} {'service' if service else 'console'} "
                              f"polling={self.c.poll_seconds}s route settings={self.route_source} "
                              f"version {(self.route_doc or {}).get('version', '-')} "
                              f"truck log={tl.api_base if tl.configured else 'NOT CONFIGURED'}")
            if tl.configured and tl.credential_format == "dpapi" and tl.dpapi_scope == "CurrentUser" and service:
                self.log("WARN", "dpapi_scope = CurrentUser cannot work under the LocalSystem service; "
                                 "set LocalMachine and re-run SETUP-TRUCK-LOG-UPLOAD.cmd as Administrator")
            try:
                if self.outbox:
                    self._get_token()
            except WatcherError as e:
                # Not fatal: cached/safe-default settings keep running and uploads wait in the outbox.
                self.log("WARN", f"Truck Log credential unavailable: {redact(e)}")
            leftovers = list((self.c.state_dir / "snapshots").glob("*.pdf"))
            if leftovers:
                self.log("WARN", f"{len(leftovers)} staging snapshot(s) from an earlier run remain in "
                                 f"{self.c.state_dir / 'snapshots'}; review manually (not auto-processed).")
            worker = poller = processor = None
            if not once:
                processor = CaptureWorker(self)
                processor.start()
            if self.outbox and not once:
                worker = UploadWorker(self.outbox, self.log)
                worker.start()
            if self.config_client is not None and not once:
                poller = RouteConfigPoller(self.config_client, lambda: self.route_doc,
                                           self.c.config_refresh_seconds, self.log)
                poller.start()
            try:
                if once:
                    self.scan()
                    time.sleep(self.c.settle_seconds)
                    count = self.scan()
                    self.process_pending()
                    if self.outbox:
                        self.outbox.process_due()
                    self.log("STOP", f"single scan complete: {count} processed")
                    return
                while not self.stop_requested():
                    self.apply_pending_config()   # between captures only
                    self.scan()
                    deadline = time.monotonic() + self.c.poll_seconds
                    while not self.stop_requested() and time.monotonic() < deadline:
                        time.sleep(min(.25, max(0, deadline - time.monotonic())))
                self.log("STOP", "service stop requested; no incoming auto-replay; pending uploads stay in the outbox")
            except KeyboardInterrupt:
                self.log("STOP", "graceful operator stop; no incoming auto-replay; pending uploads stay in the outbox")
            finally:
                # A pending snapshot can be the only copy of an overwritten capture.
                # Preserve it on shutdown even if queue backpressure prevented recovery.
                snapshots = [obs.snapshot for obs in self.observed.values() if obs.snapshot]
                if snapshots:
                    self.log("REVIEW", f"Preserved {len(snapshots)} staging snapshot(s) for manual review on restart")
                if processor:
                    processor.stop()
                    processor.join(timeout=10)
                    if processor.is_alive():
                        self.log("REVIEW", "Processing has not stopped; active captures remain durable and require manual review on restart")
                if poller:
                    poller.stop()
                if worker:
                    worker.stop()
                    worker.join(timeout=min(10, self.c.truck_log.timeout_seconds + 5))


def rotate_log(path: Path, limit: int = 10 * 1024 * 1024) -> None:
    """Keep one previous log file (<name>.1) once a log passes ~10 MiB."""
    try:
        if path.stat().st_size > limit:
            os.replace(path, path.with_name(path.name + ".1"))
    except OSError:
        pass


def setup_check(settings: TruckLogSettings, token: str,
                http: Callable[..., HttpResult] = http_request) -> tuple[bool, str]:
    """GET /print-agents/setup-check: proves the token is valid and names its agent id."""
    result = http("GET", settings.api_base + SETUP_CHECK_PATH,
                  headers={"Authorization": f"Bearer {token}", "Accept": "application/json",
                           "User-Agent": WATCHER_VERSION},
                  body=None, timeout=settings.timeout_seconds, use_system_proxy=settings.use_system_proxy)
    if result.status != 200:
        return False, server_message(result)
    try:
        doc = json.loads(result.body.decode("utf-8"))
    except ValueError:
        return False, "setup-check returned non-JSON"
    agent = str(doc.get("agentId", ""))
    if settings.agent_id and agent != settings.agent_id:
        return False, f"token belongs to agent '{agent}', watcher.ini expects '{settings.agent_id}'"
    return True, f"token accepted for agent '{agent}'"


def _age(iso: Optional[str]) -> str:
    try:
        then = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        secs = max(0, int((dt.datetime.now(dt.timezone.utc) - then).total_seconds()))
    except (TypeError, ValueError):
        return "unknown age"
    if secs < 120:
        return f"{secs} s ago"
    if secs < 7200:
        return f"{secs // 60} min ago"
    return f"{secs // 3600} h {secs % 3600 // 60} min ago" if secs < 172800 else f"{secs // 86400} days ago"


def check_command(c: Settings, online: bool = True, http: Optional[Callable[..., HttpResult]] = None) -> int:
    """Read-only: shows what the watcher would use. Never writes the cache, never prints."""
    print("TRUCK LOG SAP CAPTURE WATCHER - READ-ONLY CHECK")
    print("Host:", socket.gethostname(), "  Version:", WATCHER_VERSION)
    print("Mode: independently reconstructed, not original V3")
    issues: list[str] = []
    notes: list[str] = []
    print("State dir:", c.state_dir)
    print("SumatraPDF:", c.sumatra, "EXISTS" if c.sumatra.is_file() else "NOT FOUND")
    print("Max PDF size:", c.max_pdf_bytes // (1024 * 1024), "MiB")
    queue_dir = c.state_dir / "capture-queue"
    pending = len(list(queue_dir.glob("*.json")))
    active = len(list(queue_dir.glob("*.active")))
    review = len(list((queue_dir / "review").glob("*")))
    print(f"Capture queue: {pending} pending, {active} active, {review} review; limit {c.max_pending_captures}")
    if pending + active >= c.max_pending_captures:
        issues.append("Capture queue full: stop SAP capture submissions and investigate")
    if review:
        notes.append(f"{review} capture record(s) require manual review in {queue_dir / 'review'}")
    try:
        import pypdf
        print("pypdf:", getattr(pypdf, "__version__", "installed"))
    except ImportError:
        try:
            import fitz
            print("PyMuPDF:", getattr(fitz, "VersionBind", "installed"))
        except ImportError:
            issues.append("Install Python pypdf (or PyMuPDF) for PDF text extraction")

    tl = c.truck_log
    token: Optional[str] = None
    print("Truck Log connection:", tl.api_base if tl.configured else "NOT CONFIGURED ([truck_log] api_base)")
    if tl.configured:
        print("  agent_id:", tl.agent_id or "(not pinned)")
        prot = credential_protection(tl)
        print("  credential:", tl.credential_file, f"({prot})")
        if prot == "dpapi-CurrentUser":
            issues.append("credential is DPAPI CurrentUser: the LocalSystem service cannot read it. Run "
                          "INSTALL-WATCHER-SERVICE.cmd (migrates it) or SETUP-TRUCK-LOG-UPLOAD.cmd as Administrator")
        if not tl.api_base.endswith("/api/v1"):
            notes.append("api_base normally ends with /api/v1")
        try:
            token = load_token(tl)
            print("  credential: readable (key id", token.split("_")[1] + ")")
        except WatcherError as e:
            issues.append(redact(e))
    else:
        issues.append("Set [truck_log] api_base: route settings come from Truck Log > Admin > Printing")

    # Server reachable? (live GET, no cache write)
    server_doc: Optional[dict[str, Any]] = None
    client = RouteConfigClient(tl, c.state_dir, (lambda: token) if token else (lambda: load_token(tl)),
                               lambda *_: None, http=http)
    if not online:
        print("Truck Log route settings: not contacted (--offline)")
    elif tl.configured and token:
        res = client.request(None)
        if res.outcome == "updated" and res.document:
            server_doc = res.document
            print(f"Truck Log route settings: REACHABLE, version {server_doc['version']} by "
                  f"{server_doc.get('updatedBy') or '?'} at {server_doc.get('updatedAt') or '?'}")
            ok, msg = setup_check(tl, token, http=http or http_request)
            print("  setup-check:", msg)
            if not ok:
                issues.append("Truck Log setup-check failed: " + msg)
        elif res.outcome == "rejected":
            print("Truck Log route settings: REACHABLE but document REJECTED:", res.message)
            issues.append("Truck Log route settings rejected by this watcher: " + res.message)
        else:
            print("Truck Log route settings: NOT REACHABLE:", res.message)
            issues.append("Truck Log route settings not reachable: " + res.message)
    else:
        print("Truck Log route settings: NOT REACHABLE (no connection/credential)")

    cached = client.load_cache()
    if cached:
        cdoc = cached["document"]
        print(f"Cached route settings: version {cdoc['version']} (fetched {_age(cached.get('savedAt'))}, "
              f"last confirmed {_age(cached.get('confirmedAt'))}) in {client.cache_path}")
        if server_doc and server_doc["version"] != cdoc["version"]:
            notes.append(f"the running watcher applies version {server_doc['version']} within "
                         f"{int(c.config_refresh_seconds)} s (cache has {cdoc['version']})")
    else:
        print("Cached route settings: NONE yet", f"({client.cache_path})")

    if server_doc:
        doc, source = server_doc, "Truck Log (live)"
    elif cached:
        doc, source = cached["document"], "CACHE (Truck Log not reachable now)"
    else:
        doc, source = safe_default_document(), "SAFE DEFAULT: every route TEST (never prints), upload off"
        notes.append("no route settings yet: the watcher runs every route as TEST with upload off until "
                     "it reaches Truck Log")
    routes, warnings = build_routes(doc, c.route_paths)
    print("Effective route settings from", source)
    for r in routes:
        print(f"route{r.number} {r.name}: {r.mode}, upload {'ON' if r.upload_enabled else 'off'}, "
              f"printer {r.printer or '(none)'}{' (not used in ' + r.mode + ')' if r.printer and not r.live else ''}")
        print(f"  capture: {r.capture_file} ({'EXISTS' if r.capture_file.parent.is_dir() else 'PARENT MISSING'})"
              f"   source queue: {r.queue_name}")
    notes.extend(warnings)
    if any(r.live for r in routes) and not c.sumatra.is_file():
        issues.append("SumatraPDF path required for LIVE routes")
    if any(r.upload_enabled for r in routes) and not token:
        issues.append("upload is ON for a route but the Truck Log credential is not readable")
    if tl.configured:
        outbox = Outbox(c.state_dir / "outbox", tl, lambda: "", lambda *_: None)
        print("Upload outbox:", outbox.counts())
    if os.name != "nt":
        issues.append("Windows host required for live capture queue operation")
    print("CHECK:", "REVIEW" if issues else "CONFIGURATION PASS (no print submitted)")
    for x in issues:
        print(" -", x)
    for x in notes:
        print(" * note:", x)
    print("No changes or print jobs were made by check.")
    return 1 if issues else 0


_TOKEN_IN_TEXT = re.compile(r"tlpa_[0-9a-f]{16}_[0-9a-f]{64}(?![0-9a-f])")


def extract_token(text: str) -> Optional[str]:
    """The one token inside pasted text: tolerates the 'Bearer token (shown once):' label,
    stray control characters from a console paste, and a token wrapped over several lines."""
    for candidate in (text, "".join(ch for ch in text if ch.isprintable() and not ch.isspace())):
        found = set(_TOKEN_IN_TEXT.findall(candidate))
        if len(found) == 1:
            return found.pop()
    return None


def read_windows_clipboard() -> str:
    """Clipboard text on Windows, or '' when unavailable. Never logged or printed."""
    if os.name != "nt":
        return ""
    try:
        exe = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        done = subprocess.run([str(exe), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
                              capture_output=True, text=True, timeout=20)
        return done.stdout if done.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def describe_bad_token_input(text: str) -> str:
    """What was wrong with a rejected paste, without revealing any of it."""
    visible = "".join(ch for ch in text if ch.isprintable() and not ch.isspace())
    if not visible:
        return "nothing was received (the paste did not reach this window)"
    if "tlpa_" not in visible:
        return f"{len(visible)} characters were received but they do not contain tlpa_"
    return f"{len(visible)} characters were received; a complete token is 86 (tlpa_, 16, _, 64)"


def setup_upload_command(c: Settings, token: Optional[str] = None,
                         clipboard: Callable[[], str] = read_windows_clipboard) -> int:
    import getpass
    tl = c.truck_log
    if not tl.api_base:
        raise WatcherError("Set [truck_log] api_base in watcher.ini first")
    print("Store the Truck Log Print Agent token for the SAP queue watcher.")
    print("Credential file:", tl.credential_file, f"({tl.credential_format}, {tl.dpapi_scope})")
    if tl.credential_format == "dpapi" and tl.dpapi_scope == "CurrentUser":
        print("WARNING: dpapi_scope = CurrentUser: the LocalSystem service will NOT be able to read it.")
    else:
        print("The file is sealed for this PC (DPAPI LocalMachine) and readable only by SYSTEM and Administrators.")
    if token is None:
        pasted = getpass.getpass("Paste token (tlpa_..., input hidden; right-click to paste), then Enter: ")
        token = extract_token(pasted)
        if token is None:
            # A hidden console prompt can lose a paste (Ctrl+V, or a token copied over two lines).
            token = extract_token(clipboard())
            if token is None:
                raise WatcherError("No complete token was pasted: " + describe_bad_token_input(pasted)
                                   + ". Copy the whole tlpa_... token again and run this once more; "
                                   "it is also read straight from the clipboard if the paste fails.")
            print("The paste was incomplete; the token was read from the Windows clipboard instead.")
    else:
        token = extract_token(token) or token
    store_token(tl, token)
    if load_token(tl) != token.strip():
        raise WatcherError("Stored credential did not read back correctly")
    print("[PASS] Credential stored; the token is not written to watcher.ini or logs.")
    ok, msg = setup_check(tl, token.strip())
    print(("[PASS] " if ok else "[REVIEW] ") + "Truck Log " + msg)
    print("The running service picks the new credential up within a minute (no restart needed).")
    print("Upload and printing are switched per route in Truck Log > Admin > Printing.")
    return 0 if ok else 1


def conflicts_command(lister: Callable[[], list[dict[str, Any]]] = list_python_processes) -> int:
    """For the service installer: exit 3 if another SAP watcher Python process is running."""
    found = conflicting_watchers(lister(), os.getpid(), os.getppid())
    for p in found:
        print(f"RUNNING: pid {p.get('ProcessId')}: {redact(p.get('CommandLine') or '')[:300]}")
    if not found:
        print("No other SAP watcher Python process is running.")
    return 3 if found else 0


def paths_command(c: Settings) -> int:
    """Machine-readable paths for the PowerShell installer (validates watcher.ini)."""
    print(json.dumps({"stateDir": str(c.state_dir), "credentialFile": str(c.truck_log.credential_file),
                      "credentialFormat": c.truck_log.credential_format, "dpapiScope": c.truck_log.dpapi_scope,
                      "credentialProtection": credential_protection(c.truck_log),
                      "apiBase": c.truck_log.api_base, "sumatra": str(c.sumatra),
                      "routeConfigCache": str(c.state_dir / ROUTE_CONFIG_CACHE)}))
    return 0


def redirect_service_console(folder: Path) -> None:
    """Service child has no console: keep stdout/stderr (tracebacks) in state_dir."""
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "watcher-service-console.log"
    rotate_log(path)
    stream = open(path, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = stream


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["check", "run", "once", "setup-upload", "upload-now", "requeue-failed",
                                           "migrate-credential", "conflicts", "paths"],
                        nargs="?", default="check")
    parser.add_argument("--config", default=str(Path(__file__).with_name("watcher.ini")))
    parser.add_argument("--offline", action="store_true", help="check: do not contact Truck Log")
    parser.add_argument("--service", action="store_true",
                        help="run: started by the Windows service host (no console, stop via --stop-file)")
    parser.add_argument("--stop-file", help="run --service: graceful stop when this file contains --run-id")
    parser.add_argument("--run-id", help="run --service: id written by the service host")
    args = parser.parse_args(argv)
    if args.service:
        if args.action != "run" or not args.stop_file or not args.run_id:
            parser.error("--service requires the run action, --stop-file and --run-id")
        if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", args.run_id):
            parser.error("--run-id has an invalid format")
        redirect_service_console(Path(args.stop_file).parent)
    elif args.stop_file or args.run_id:
        parser.error("--stop-file/--run-id are only valid with --service")
    try:
        if args.action == "conflicts":
            return conflicts_command()
        c = load_config(Path(args.config))
        if args.action == "check":
            return check_command(c, online=not args.offline)
        if args.action == "paths":
            return paths_command(c)
        if args.action == "setup-upload":
            return setup_upload_command(c)
        if args.action == "migrate-credential":
            token = migrate_credential(c.truck_log)
            print(f"[PASS] Credential (key id {token.split('_')[1]}) is sealed DPAPI LocalMachine and "
                  "readable only by SYSTEM and Administrators.")
            return 0
        if args.action in ("upload-now", "requeue-failed"):
            if not c.truck_log.configured:
                raise WatcherError("[truck_log] api_base is not set")
            w = Watcher(c, routes=())
            assert w.outbox is not None
            if args.action == "requeue-failed":
                print("Requeued", w.outbox.requeue_failed(), "failed upload(s)")
            print(w.outbox.process_due(limit=1000), w.outbox.counts())
            return 0
        if os.name != "nt" and os.environ.get("TRUCK_LOG_WATCHER_SIMULATION") != "1":
            raise WatcherError("Refusing live watcher start on non-Windows host")
        stop_file = Path(args.stop_file) if args.service else None
        Watcher(c, stop_file=stop_file, run_id=args.run_id).run(once=(args.action == "once"), service=args.service)
        return 0
    except (WatcherError, OSError, configparser.Error) as e:
        print("[FAIL]", redact(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
