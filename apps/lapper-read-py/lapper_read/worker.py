"""Sampler + publisher threads: polling the machine never waits on the API."""

from __future__ import annotations

import logging
import os
import queue
import threading
import time
from dataclasses import dataclass, field

from . import argonaut as argo
from .api import MeshForgeApi, utc_now
from .fanuc import Fanuc, NoGearsetLoaded
from .scanner import Scanner
from .scanner_monitor import ScannerMonitor
from .state import ArgonautPost, CycleState, CycleStateStore, MachineState, ScannerState, cycle_seconds
from .tracker import DEFAULT_MAX_SAMPLE_GAP_S, CycleTracker

log = logging.getLogger("lapper_read")

#: Oldest unsent Argonaut posts are dropped beyond this, so a long outage cannot grow the checkpoint forever.
ARGONAUT_QUEUE_LIMIT = 1000


@dataclass(frozen=True)
class Telemetry:
    machine: MachineState
    process: str | None
    queue: str | None
    scanner: str | None
    #: When the current cycle went into cycle (this collector's clock), if that was seen.
    cycle_started_at: str | None = None


#: Machine I/O is reported at least this often, even when nothing changed, so MeshForge can tell a
#: running cycle from a collector that stopped (keep in step with LIVE_REPORT_INTERVAL_S).
LIVE_REPORT_INTERVAL_S = 30.0
#: Longest elapsed time the API accepts; a cycle "running" longer is reported as unknown.
MAX_CYCLE_ELAPSED_S = 86400.0


def cycle_elapsed_s(started_at: str | None, now: str) -> float | None:
    """Seconds from `started_at` to `now` (both this collector's clock), or None when unknown."""
    seconds = cycle_seconds(started_at, now)
    return seconds if seconds is not None and seconds <= MAX_CYCLE_ELAPSED_S else None


@dataclass
class MacroRead:
    """A request to read macros now, served by the sampling thread (the only one that uses FOCAS)."""
    numbers: tuple[int, ...]
    done: threading.Event = field(default_factory=threading.Event)
    values: dict[str, str | None] | None = None
    error: str | None = None


class MacroReadError(RuntimeError):
    pass


class Worker:
    def __init__(self, settings, api: MeshForgeApi, fanuc: Fanuc, scanner: Scanner | None, store: CycleStateStore,
                 scanner_monitor: ScannerMonitor | None = None, argonaut: argo.ArgonautClient | None = None):
        """`scanner` None: the machine has no scanner, so cycles are recorded without a serial."""
        self.settings, self.api, self.fanuc, self.scanner, self.store = settings, api, fanuc, scanner, store
        self.scanner_monitor = scanner_monitor or (
            ScannerMonitor(settings.scanner_ip, settings.scanner_input1_port, settings.io_timeout_ms / 1000)
            if scanner else None
        )
        self.argonaut = argonaut
        if self.argonaut is None and getattr(settings, "argonaut_enabled", False):
            self.argonaut = argo.ArgonautClient(
                settings.argonaut_url, settings.argonaut_location_id, settings.argonaut_username,
                settings.argonaut_password, settings.argonaut_timeout_s, settings.argonaut_verify_tls,
                settings.argonaut_ca_file,
            )
        self._argonaut_retry_at = 0.0
        self.argonaut_last_sent_at: str | None = None
        self.argonaut_last_error: str | None = None
        self.stop_event = threading.Event()
        self._reads: queue.Queue[MacroRead] = queue.Queue()
        self._lock = threading.Lock()
        self._tracker = self._new_tracker(CycleState())
        self._dirty = False
        self._latest: Telemetry | None = None
        self._saved: Telemetry | None = None
        self._io_reported_at = float("-inf")
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
            argonaut_pending = len(self._tracker.state.argonaut_pending)
        argonaut = {"argonaut": "off"}
        if self.argonaut:
            argonaut = {"argonaut": "on", "argonaut_pending": argonaut_pending,
                        "argonaut_last_sent_at": self.argonaut_last_sent_at,
                        "argonaut_last_error": self.argonaut_last_error}
        return {
            "phase": self.phase,
            "last_sample_at": self.last_sample_at,
            "last_error": self.last_error,
            "pending_runs": pending,
            "in_cycle_serial": active.serial if active else None,
            "serials": "scanned" if self.scanner else "none (no scanner)",
            **(self.scanner_monitor.status() if self.scanner_monitor else {"scanner": "none"}),
            **argonaut,
        }

    def _new_tracker(self, state: CycleState) -> CycleTracker:
        # A cycle's start or end is timed only when the previous sample was a few polls before it.
        poll_s = getattr(self.settings, "poll_interval_ms", 250) / 1000
        return CycleTracker(state, max_sample_gap_s=max(DEFAULT_MAX_SAMPLE_GAP_S, 4 * poll_s))

    # -- lifecycle ----------------------------------------------------------
    def run(self) -> None:
        self.store.acquire_lease()
        try:
            self._tracker = self._new_tracker(self.store.load())
            held = len(self._tracker.state.argonaut_pending)
            if held and not self.argonaut:
                log.warning("[%s] %d cycle(s) are waiting for Argonaut, which is now off for this machine; "
                            "they are kept and sent if it is turned back on",
                            self.settings.machine_number or self.settings.machine_ip, held)
            if not self._initialize():
                return
            publisher = threading.Thread(target=self._publish_loop, name="publisher", daemon=True)
            publisher.start()
            if self.scanner_monitor:
                self.scanner_monitor.start()
            self._sample_loop()
            publisher.join(timeout=10)
        finally:
            with self._lock:
                if self._dirty:
                    try:
                        self._checkpoint()
                    except Exception:  # noqa: BLE001
                        log.exception("Unable to flush the final cycle checkpoint")
            self._serve_reads(stopping=True)
            self.fanuc.close()
            self.fanuc.release_thread()
            if self.scanner_monitor:
                self.scanner_monitor.stop()
            if self.scanner:
                self.scanner.close()
            self.store.release_lease()
            self.phase = "stopped"
            log.info("Lapper Read stopped; pending cycles remain in the checkpoint")

    def stop(self, *_args) -> None:
        self.stop_event.set()

    def read_macros(self, numbers, timeout_s: float = 15.0) -> dict[str, str | None]:
        """The controller's current values of `numbers` (None for a macro it does not answer), read
        between samples so the FOCAS handle is only ever used by the sampling thread."""
        request = MacroRead(tuple(int(n) for n in numbers))
        self._reads.put(request)
        if not request.done.wait(timeout_s):
            raise MacroReadError(f"the controller did not answer within {timeout_s:.0f}s (worker is {self.phase})")
        if request.error is not None:
            raise MacroReadError(request.error)
        return request.values or {}

    def _serve_reads(self, stopping: bool = False) -> None:
        while True:
            try:
                request = self._reads.get_nowait()
            except queue.Empty:
                return
            try:
                if stopping:
                    raise MacroReadError("the worker is stopping")
                request.values = self.fanuc.capture_numbers(request.numbers)
            except Exception as error:  # noqa: BLE001 - reported to whoever asked
                request.error = f"reading the controller failed: {error}"
            finally:
                request.done.set()

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
                        raise IOError("The configured scanner is not assigned to this machine in MeshForge (Lapper > Scanners).")
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
        label = s.machine_number or s.machine_ip
        while not self.stop_event.is_set():
            self._serve_reads()
            try:
                with self._lock:
                    if self._dirty:
                        self._checkpoint()
                    state = self._tracker.state
                    previous = ScannerState(state.scanner_serial, state.queued_serial)
                machine = self.fanuc.read_state()
                scanner = previous
                monitor = self.scanner_monitor
                if self.scanner and monitor and monitor.should_read():
                    try:
                        scanner = self.scanner.read(previous)
                        if monitor.read_succeeded():
                            log.info("[%s] Scanner %s is online again; cycles get scanned serials", label, s.scanner_ip)
                    except (OSError, TimeoutError) as error:
                        if monitor.read_failed(error):
                            log.warning("[%s] Scanner %s is offline (%s); cycles are recorded without a serial and "
                                        "the scanner is pinged and retried every %ds", label, s.scanner_ip, error,
                                        int(monitor.check_interval_s))
                with self._lock:
                    state = self._tracker.state
                    before = state.snapshot()
                    active_before = state.active_cycle
                    capture_argonaut = (lambda: self.fanuc.capture_numbers(argo.MACROS)) if self.argonaut else None
                    self._tracker.observe(machine, scanner, self.machine["id"], self.fanuc.capture_macros, utc_now(),
                                          capture_argonaut)
                    overflow = len(state.argonaut_pending) - ARGONAUT_QUEUE_LIMIT
                    if overflow > 0:
                        dropped = state.argonaut_pending[:overflow]
                        del state.argonaut_pending[:overflow]
                        log.error("[%s] Argonaut queue is full; dropped the oldest %d unsent cycle(s) (consec %s)",
                                  label, overflow, ", ".join(str(p.consec) for p in dropped))
                    if self.scanner and state.active_cycle is not active_before and state.active_cycle and not state.active_cycle.serial:
                        log.info("[%s] Cycle %s has no confirmed scanned serial; it is recorded without one",
                                 label, machine.consec)
                    if state.snapshot() != before:
                        self._dirty = True
                        self._checkpoint()
                    active = state.active_cycle
                    self._latest = Telemetry(machine, active.serial if active else None,
                                             state.queued_serial, state.scanner_serial,
                                             active.cycle_started_at if active and machine.in_cycle else None)
                self._heartbeat()
                self.last_sample_at = utc_now()
                if self.phase != "collecting" or self.last_error:
                    self.phase, self.last_error = "collecting", None
                if not self._sleep(s.poll_interval_ms):
                    break
            except NoGearsetLoaded as error:
                # The control is connected but idle: not an error, and logged once per idle spell.
                if self.phase != "no gearset loaded":
                    log.info("[%s] Controller connected but idle: %s", label, error)
                self.phase, self.last_error = "no gearset loaded", None
                self.last_sample_at = utc_now()
                if not self._sleep(s.retry_delay_ms):
                    break
            except Exception as error:  # noqa: BLE001
                self.phase, self.last_error = "controller unavailable", str(error)
                log.error("[%s] Machine polling failed; keeping the last confirmed state: %s", label, error)
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
        self.publish_argonaut_once()
        with self._lock:
            if self._dirty:
                self._checkpoint()
            pending = self._tracker.state.pending_cycles[0] if self._tracker.state.pending_cycles else None
            telemetry = self._latest
        if pending is not None:
            if pending.saved_cycle is None:
                gearset = self.api.gearset_by_number(pending.part_number)
                saved = self.api.post_cycle(pending.serial, pending.consec, pending.machine_id,
                                            gearset["id"], pending.completed_at or utc_now(), pending.id,
                                            pending.cycle_time_s())
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
        heartbeat_due = time.monotonic() - self._io_reported_at >= LIVE_REPORT_INTERVAL_S
        if telemetry is not None and (telemetry != self._saved or heartbeat_due):
            # Serials only change with the telemetry; the heartbeat repeats the machine I/O alone.
            if self.scanner_detail and (self._saved is None or
                                        (telemetry.process, telemetry.queue, telemetry.scanner) !=
                                        (self._saved.process, self._saved.queue, self._saved.scanner)):
                self.api.patch_scanner_serials(self.scanner_detail["id"], telemetry.process, telemetry.queue, telemetry.scanner)
            m = telemetry.machine
            elapsed = cycle_elapsed_s(telemetry.cycle_started_at, utc_now()) if m.in_cycle else None
            self.api.patch_fanuc_variables(self.variables["id"], m.door_closed, m.start_cycle, m.in_cycle, elapsed)
            self._saved = telemetry
            self._io_reported_at = time.monotonic()


    def publish_argonaut_once(self) -> None:
        """Sends the oldest queued cycle to Argonaut. Failures are logged and retried later, and never
        raise, so MeshForge publishing carries on during an Argonaut outage."""
        if self.argonaut is None or time.monotonic() < self._argonaut_retry_at:
            return
        with self._lock:
            post: ArgonautPost | None = self._tracker.state.argonaut_pending[0] if self._tracker.state.argonaut_pending else None
        if post is None:
            return
        label = self.settings.machine_number or self.settings.machine_ip
        if not post.serial:
            # Argonaut tracks parts by serial; a cycle without a scanned serial cannot be sent.
            log.warning("[%s] Cycle %s has no scanned serial; not sent to Argonaut", label, post.consec)
            self._finish_argonaut(post)
            return
        missing = [n for n, v in post.values.items() if v is None]
        try:
            self.argonaut.post(argo.build_payload(post.serial, post.part_number, post.consec, post.values,
                                                  self.settings.argonaut_transaction_type_id, post.cycle_time_s))
        except Exception as error:  # noqa: BLE001 - Argonaut must never stop MeshForge publishing
            if not isinstance(error, argo.ArgonautError):
                error = argo.ArgonautError(str(error))
            self.argonaut_last_error = str(error)
            if error.permanent:
                log.error("[%s] Argonaut rejected cycle %s for serial %s; not retried: %s",
                          label, post.consec, post.serial, error)
                self._finish_argonaut(post)
                return
            with self._lock:
                post.attempts += 1
                self._dirty = True
            delay = min(self.settings.retry_delay_ms / 1000 * 2 ** min(post.attempts, 6), 300)
            self._argonaut_retry_at = time.monotonic() + delay
            log.error("[%s] Argonaut post for cycle %s failed (attempt %d); retrying in %.0fs: %s",
                      label, post.consec, post.attempts, delay, error)
            return
        self.argonaut_last_sent_at, self.argonaut_last_error = utc_now(), None
        cycle_time = f"{post.cycle_time_s:.1f}s" if post.cycle_time_s is not None else "unknown, sent as 0"
        log.info("[%s] Sent cycle %s for serial %s (gearset %s) to Argonaut, cycle time %s%s", label, post.consec,
                 post.serial, post.part_number, cycle_time,
                 f"; {len(missing)} macros unavailable, sent as 0" if missing else "")
        self._finish_argonaut(post)

    def _finish_argonaut(self, post: ArgonautPost) -> None:
        with self._lock:
            pending = self._tracker.state.argonaut_pending
            pending[:] = [queued for queued in pending if queued is not post]
            self._dirty = True
            self._checkpoint()


def heartbeat_age_s(path: str) -> float:
    return time.time() - os.path.getmtime(path)
