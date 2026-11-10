"""Sampler + publisher threads: polling the machine never waits on the API."""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass

from .api import GearAppsApi, utc_now
from .fanuc import Fanuc
from .scanner import Scanner
from .state import CycleState, CycleStateStore, MachineState, ScannerState
from .tracker import CycleTracker

log = logging.getLogger("lapper_read")


@dataclass(frozen=True)
class Telemetry:
    machine: MachineState
    process: str | None
    queue: str | None
    scanner: str | None


class Worker:
    def __init__(self, settings, api: GearAppsApi, fanuc: Fanuc, scanner: Scanner | None, store: CycleStateStore):
        """`scanner` None: the machine has no scanner, so cycles are recorded without a serial."""
        self.settings, self.api, self.fanuc, self.scanner, self.store = settings, api, fanuc, scanner, store
        self.stop_event = threading.Event()
        self._lock = threading.Lock()
        self._tracker = self._new_tracker(CycleState())
        self._dirty = False
        self._latest: Telemetry | None = None
        self._saved: Telemetry | None = None
        self.machine: dict = {}
        self.scanner_detail: dict = {}
        self.variables: dict = {}
        # Read by the supervisor's status page.
        self.phase = "starting"
        self.last_error: str | None = None
        self.last_sample_at: str | None = None

    def status(self) -> dict:
        with self._lock:
            pending = len(self._tracker.state.pending_cycles)
            active = self._tracker.state.active_cycle
        return {
            "phase": self.phase,
            "last_sample_at": self.last_sample_at,
            "last_error": self.last_error,
            "pending_runs": pending,
            "in_cycle_serial": active.serial if active else None,
            "serials": "scanned" if self.scanner else "none (no scanner)",
        }

    def _new_tracker(self, state: CycleState) -> CycleTracker:
        return CycleTracker(state, require_serial=self.scanner is not None)

    # -- lifecycle ----------------------------------------------------------
    def run(self) -> None:
        self.store.acquire_lease()
        try:
            self._tracker = self._new_tracker(self.store.load())
            if not self._initialize():
                return
            publisher = threading.Thread(target=self._publish_loop, name="publisher", daemon=True)
            publisher.start()
            self._sample_loop()
            publisher.join(timeout=10)
        finally:
            with self._lock:
                if self._dirty:
                    try:
                        self._checkpoint()
                    except Exception:  # noqa: BLE001
                        log.exception("Unable to flush the final cycle checkpoint")
            self.fanuc.close()
            self.fanuc.release_thread()
            if self.scanner:
                self.scanner.close()
            self.store.release_lease()
            self.phase = "stopped"
            log.info("Lapper Read stopped; pending cycles remain in the checkpoint")

    def stop(self, *_args) -> None:
        self.stop_event.set()

    def _sleep(self, ms: int) -> bool:
        """Sleeps unless stopping; returns False when the worker should stop."""
        return not self.stop_event.wait(ms / 1000)

    def _initialize(self) -> bool:
        s = self.settings
        while not self.stop_event.is_set():
            try:
                self.machine = self.api.machine_by_ip(s.machine_ip, s.machine_number)
                self.variables = self.api.fanuc_variables(self.machine["id"])
                if self.scanner:
                    self.scanner_detail = self.api.scanner_by_ip(s.scanner_ip)
                    assigned = self.scanner_detail.get("machine_id") or (self.scanner_detail.get("machine") or {}).get("id")
                    if str(assigned).lower() != str(self.machine["id"]).lower():
                        raise IOError("The configured scanner is not assigned to this machine in GearApps (Lapper > Scanners).")
                self.fanuc.initialize()
                self.phase, self.last_error = "collecting", None
                log.info("[%s] Collecting for machine %s (%s), %s, %d macros",
                         s.machine_number or s.machine_ip, self.machine.get("number"), s.machine_ip,
                         f"scanner {s.scanner_ip}" if self.scanner else "no scanner: cycles recorded without a serial",
                         len(self.fanuc._macros))
                return True
            except Exception as error:  # noqa: BLE001
                self.phase, self.last_error = "waiting for setup", str(error)
                log.error("[%s] Unable to initialize Lapper Read; retrying: %s", s.machine_number or s.machine_ip, error)
                if not self._sleep(s.retry_delay_ms):
                    break
        return False

    def _checkpoint(self) -> None:
        self.store.save(self._tracker.state)
        self._dirty = False

    def _heartbeat(self) -> None:
        path = self.settings.heartbeat_file
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(utc_now())

    # -- sampling -------------------------------------------------------------
    def _sample_loop(self) -> None:
        s = self.settings
        retry_scanner_after = 0.0
        while not self.stop_event.is_set():
            try:
                with self._lock:
                    if self._dirty:
                        self._checkpoint()
                    state = self._tracker.state
                    previous = ScannerState(state.scanner_serial, state.queued_serial)
                machine = self.fanuc.read_state()
                scanner = previous
                if self.scanner and time.monotonic() >= retry_scanner_after:
                    try:
                        scanner = self.scanner.read(previous)
                        retry_scanner_after = 0.0
                    except (OSError, TimeoutError) as error:
                        retry_scanner_after = time.monotonic() + s.retry_delay_ms / 1000
                        log.warning("Scanner unavailable; preserving its last known serials: %s", error)
                with self._lock:
                    state = self._tracker.state
                    before = state.snapshot()
                    active_before = state.active_cycle
                    self._tracker.observe(machine, scanner, self.machine["id"], self.fanuc.capture_macros, utc_now())
                    if self.scanner and state.active_cycle is not active_before and state.active_cycle and not state.active_cycle.serial:
                        log.warning("Cycle %s has no confirmed scanned serial; it will not be recorded under a substitute serial",
                                    machine.consec)
                    if state.snapshot() != before:
                        self._dirty = True
                        self._checkpoint()
                    self._latest = Telemetry(machine, state.active_cycle.serial if state.active_cycle else None,
                                             state.queued_serial, state.scanner_serial)
                self._heartbeat()
                self.last_sample_at = utc_now()
                if self.phase != "collecting" or self.last_error:
                    self.phase, self.last_error = "collecting", None
                if not self._sleep(s.poll_interval_ms):
                    break
            except Exception as error:  # noqa: BLE001
                self.phase, self.last_error = "controller unavailable", str(error)
                log.error("[%s] Machine polling failed; keeping the last confirmed state: %s",
                          s.machine_number or s.machine_ip, error)
                if not self._sleep(s.retry_delay_ms):
                    break

    # -- publishing -----------------------------------------------------------
    def _publish_loop(self) -> None:
        s = self.settings
        while not self.stop_event.is_set():
            try:
                self.publish_once()
                if not self._sleep(s.poll_interval_ms):
                    break
            except Exception as error:  # noqa: BLE001
                self.last_error = f"API: {error}"
                log.error("[%s] API publishing failed; pending records will be retried: %s",
                          s.machine_number or s.machine_ip, error)
                if not self._sleep(s.retry_delay_ms):
                    break

    def publish_once(self) -> None:
        with self._lock:
            if self._dirty:
                self._checkpoint()
            pending = self._tracker.state.pending_cycles[0] if self._tracker.state.pending_cycles else None
            telemetry = self._latest
        if pending is not None:
            if pending.saved_cycle is None:
                gearset = self.api.gearset_by_number(pending.part_number)
                saved = self.api.post_cycle(pending.serial, pending.consec, pending.machine_id,
                                            gearset["id"], pending.completed_at or utc_now(), pending.id)
                with self._lock:
                    pending.saved_cycle = {"id": saved["id"], "machine_id": pending.machine_id, "gearset_id": gearset["id"]}
                    self._dirty = True
                    self._checkpoint()
            # Values were captured at completion; a retry never re-reads the machine.
            written = self.fanuc.persist_macros(pending.saved_cycle, pending.macro_values(), pending.id)
            with self._lock:
                self._tracker.state.pending_cycles.remove(pending)
                self._dirty = True
                self._checkpoint()
            log.info("[%s] Recorded cycle %s for serial %s (gearset %s): %d changed macros",
                     self.settings.machine_number or self.settings.machine_ip,
                     pending.consec, pending.serial or "(none, no scanner)", pending.part_number, written)
        if telemetry is not None and telemetry != self._saved:
            if self.scanner_detail:
                self.api.patch_scanner_serials(self.scanner_detail["id"], telemetry.process, telemetry.queue, telemetry.scanner)
            m = telemetry.machine
            self.api.patch_fanuc_variables(self.variables["id"], m.door_closed, m.start_cycle, m.in_cycle)
            self._saved = telemetry


def heartbeat_age_s(path: str) -> float:
    return time.time() - os.path.getmtime(path)
