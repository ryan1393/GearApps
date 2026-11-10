"""Turns machine and scanner samples into cycles, without network calls."""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal

from .state import CycleState, MachineState, PendingCycle, ScannerState


class CycleTracker:
    def __init__(self, state: CycleState, require_serial: bool = True):
        """require_serial=False is for a machine with no scanner: every completed cycle is kept,
        with no serial. With a scanner, a cycle without a confirmed scan is never recorded."""
        self.state = state
        self.require_serial = require_serial

    def observe(
        self,
        machine: MachineState,
        scanner: ScannerState,
        machine_id: str,
        capture_macros: Callable[[], dict[str, Decimal]],
        timestamp: str,
    ) -> None:
        state = self.state
        queued = scanner.queue
        if machine.in_cycle and state.was_in_cycle is not True and state.active_cycle is None:
            # Starting halfway through a cycle cannot establish which part was loaded.
            serial = queued if state.was_in_cycle is False and machine.door_closed and machine.start_cycle else None
            serial = serial if serial and serial.strip() else None
            state.active_cycle = PendingCycle(
                machine_id=machine_id,
                part_number=machine.ident,
                consec=machine.consec,
                started_at=timestamp,
                serial=serial,
            )
            if serial:
                queued = None  # the queued part is now the one in process
        if not machine.in_cycle and not machine.door_closed and state.active_cycle is not None:
            active = state.active_cycle
            if active.serial or not self.require_serial:
                # Macro values are captured once, at completion, and never re-read on retry.
                active.macros = {key: str(value) for key, value in capture_macros().items()}
                active.completed_at = timestamp
                state.pending_cycles.append(active)
            state.active_cycle = None
        state.scanner_serial = scanner.serial
        state.queued_serial = queued
        state.was_in_cycle = machine.in_cycle
