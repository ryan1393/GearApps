"""Runs one collector worker per lapper, following the machines saved in GearApps.

Every `discover_interval_s` the supervisor reads Lapper's machines and scanners:

- an Active machine with a FANUC controller IP and an assigned scanner gets a worker;
- changing its controller IP, asset number or scanner restarts that worker;
- making it Inactive, removing its IP or scanner, or deleting it stops the worker.

Each worker runs on its own thread, so its FOCAS handle is opened and used on one thread,
and keeps its checkpoint under the machine's GearApps id (it survives IP changes).
"""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import threading
from dataclasses import dataclass, replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from .api import GearAppsApi, utc_now
from .fanuc import Fanuc
from .scanner import Scanner
from .state import CycleStateStore
from .worker import Worker

log = logging.getLogger("lapper_read.supervisor")


@dataclass(frozen=True)
class MachineSpec:
    machine_id: str
    number: str | None
    controller_ip: str
    scanner_ip: str
    cell: str | None


def desired_machines(
    machines: list[dict], scanners: list[dict]
) -> tuple[dict[str, MachineSpec], dict[str, tuple[str, str]]]:
    """Machines that should have a worker, plus (asset number, reason) for every other machine."""
    by_machine = {s.get("machine_id"): s for s in scanners if s.get("machine_id")}
    wanted: dict[str, MachineSpec] = {}
    skipped: dict[str, tuple[str, str]] = {}
    for m in machines:
        mid = m.get("id")
        if not mid:
            continue
        label = m.get("number") or mid
        if str(m.get("status", "")).lower() != "active":
            skipped[mid] = (label, "machine is inactive")
            continue
        ip = (m.get("ip") or "").strip()
        if not _is_ip(ip):
            skipped[mid] = (label, "no FANUC controller IP")
            continue
        scanner = m.get("scanner") or by_machine.get(mid)
        scanner_ip = ((scanner or {}).get("ip") or "").strip()
        if not _is_ip(scanner_ip):
            skipped[mid] = (label, "no scanner assigned (Configuration > Scanners)")
            continue
        if str((scanner or {}).get("status", "active")).lower() != "active":
            skipped[mid] = (label, "assigned scanner is inactive")
            continue
        wanted[mid] = MachineSpec(mid, m.get("number"), ip, scanner_ip, m.get("cell"))
    return wanted, skipped


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


WorkerFactory = Callable[[MachineSpec], Worker]


class _Slot:
    def __init__(self, spec: MachineSpec, factory: WorkerFactory, retry_s: float):
        self.spec, self._factory, self._retry_s = spec, factory, retry_s
        self.stopping = threading.Event()
        self.worker: Worker | None = None
        self.started_at = utc_now()
        self.restarts = 0
        self.thread = threading.Thread(target=self._loop, name=f"worker-{spec.number or spec.machine_id}", daemon=True)

    def _loop(self) -> None:
        # A worker only returns when stopped; if it fails (e.g. a locked or invalid checkpoint)
        # it is rebuilt after a pause so one bad machine never stops the others.
        while not self.stopping.is_set():
            try:
                self.worker = self._factory(self.spec)
                if self.stopping.is_set():
                    break
                self.worker.run()
            except Exception as error:  # noqa: BLE001
                self.restarts += 1
                log.error("[%s] Worker stopped unexpectedly; restarting in %.0fs: %s",
                          self.spec.number or self.spec.controller_ip, self._retry_s, error)
                if self.worker is not None:
                    self.worker.phase, self.worker.last_error = "restarting", str(error)
                self.stopping.wait(self._retry_s)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stopping.set()
        if self.worker is not None:
            self.worker.stop()

    def status(self) -> dict:
        base = {
            "machine_id": self.spec.machine_id,
            "number": self.spec.number,
            "cell": self.spec.cell,
            "controller_ip": self.spec.controller_ip,
            "scanner_ip": self.spec.scanner_ip,
            "started_at": self.started_at,
            "restarts": self.restarts,
        }
        return {**base, **(self.worker.status() if self.worker else {"phase": "starting"})}


class Supervisor:
    def __init__(self, settings, api: GearAppsApi, worker_factory: WorkerFactory | None = None):
        self.settings, self.api = settings, api
        self._factory = worker_factory or self._build_worker
        self._slots: dict[str, _Slot] = {}
        self._skipped: dict[str, tuple[str, str]] = {}
        self._last_discovery: str | None = None
        self._last_error: str | None = None
        self._stop = threading.Event()
        self._http: ThreadingHTTPServer | None = None

    # -- worker construction --------------------------------------------------------
    def _build_worker(self, spec: MachineSpec) -> Worker:
        from .focas import FocasTransport  # imported lazily so tests never need the library

        s = replace(self.settings, machine_ip=spec.controller_ip, machine_number=spec.number,
                    scanner_ip=spec.scanner_ip, state_key=spec.machine_id)
        transport = FocasTransport(s.focas_library, s.focas_log, s.focas_port)
        fanuc = Fanuc(transport, s.machine_ip, s.io_timeout_ms, self.api)
        scanner = Scanner(s.scanner_ip, s.scanner_input1_port, s.io_timeout_ms / 1000)
        return Worker(s, self.api, fanuc, scanner, CycleStateStore(s.state_file))

    # -- reconcile ---------------------------------------------------------------------
    def discover_once(self) -> None:
        machines = self.api.request("GET", "/api/v1/machine") or []
        scanners = self.api.request("GET", "/api/v1/scanner-detail") or []
        wanted, skipped = desired_machines(machines, scanners)
        for mid, slot in list(self._slots.items()):
            if mid not in wanted or wanted[mid] != slot.spec:
                reason = "settings changed" if mid in wanted else "no longer eligible"
                log.info("[%s] Stopping worker (%s)", slot.spec.number or slot.spec.controller_ip, reason)
                slot.stop()
                slot.thread.join(timeout=15)
                del self._slots[mid]
        for mid, spec in wanted.items():
            if mid not in self._slots:
                log.info("[%s] Starting worker: controller %s, scanner %s",
                         spec.number or spec.controller_ip, spec.controller_ip, spec.scanner_ip)
                slot = _Slot(spec, self._factory, self.settings.retry_delay_ms / 1000 * 6)
                self._slots[mid] = slot
                slot.start()
        if skipped != self._skipped:
            for label, reason in sorted(skipped.values()):
                log.info("[%s] No worker: %s", label, reason)
        self._skipped = skipped
        self._last_discovery = utc_now()
        self._last_error = None
        self._heartbeat()

    def run(self) -> None:
        self._start_status_server()
        log.info("Supervisor watching GearApps machines every %ss", self.settings.discover_interval_s)
        try:
            while not self._stop.is_set():
                try:
                    self.discover_once()
                except Exception as error:  # noqa: BLE001 - keep existing workers running
                    self._last_error = str(error)
                    log.error("Machine discovery failed; existing workers keep running: %s", error)
                self._stop.wait(self.settings.discover_interval_s)
        finally:
            for slot in self._slots.values():
                slot.stop()
            for slot in self._slots.values():
                slot.thread.join(timeout=15)
            if self._http:
                self._http.shutdown()
            log.info("Supervisor stopped")

    def stop(self, *_args) -> None:
        self._stop.set()

    # -- status -------------------------------------------------------------------------
    def status(self) -> dict:
        return {
            "last_discovery": self._last_discovery,
            "last_error": self._last_error,
            "workers": [slot.status() for slot in self._slots.values()],
            "machines_without_worker": [
                {"machine_id": mid, "number": label, "reason": reason}
                for mid, (label, reason) in sorted(self._skipped.items(), key=lambda item: item[1])
            ],
        }

    def summary(self) -> dict:
        """What the Lapper UI shows per machine: no IPs, credentials or raw error text."""
        machines = [
            {
                "machine_id": slot.spec.machine_id,
                "worker": True,
                "phase": status.get("phase"),
                "last_sample_at": status.get("last_sample_at"),
                "pending_runs": status.get("pending_runs", 0),
            }
            for slot in self._slots.values()
            for status in [slot.status()]
        ]
        machines += [
            {"machine_id": mid, "worker": False, "phase": reason}
            for mid, (_label, reason) in self._skipped.items()
        ]
        return {"last_discovery": self._last_discovery, "machines": machines}

    def _heartbeat(self) -> None:
        os.makedirs(self.settings.state_dir, exist_ok=True)
        with open(supervisor_heartbeat(self.settings), "w", encoding="utf-8") as handle:
            handle.write(utc_now())

    def _start_status_server(self) -> None:
        if not self.settings.status_port:
            return
        supervisor = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):  # noqa: N802
                path = self.path.split("?")[0]
                if path == "/machines":  # the slice the Lapper UI reads through its proxy
                    payload, code = supervisor.summary(), 200
                elif path in ("/", "/status"):  # full detail, for operators on the plant network
                    payload, code = supervisor.status(), 200
                else:
                    payload, code = {"message": "not found"}, 404
                body = json.dumps(payload, indent=2).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self._http = ThreadingHTTPServer(("0.0.0.0", self.settings.status_port), Handler)
        threading.Thread(target=self._http.serve_forever, name="status", daemon=True).start()
        log.info("Worker status on http://<host>:%s/status", self.settings.status_port)


def supervisor_heartbeat(settings) -> str:
    return os.path.join(settings.state_dir, "supervisor.heartbeat")
