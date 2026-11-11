"""Turns machine and scanner samples into cycles, without network calls."""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal

from .state import ArgonautPost, CycleState, MachineState, PendingCycle, ScannerState


class CycleTracker:
    def __init__(self, state: CycleState):
        """Every completed cycle is recorded: with the confirmed scanned serial when there is one,
        otherwise with no serial (no scanner, scanner offline, or nothing scanned). A cycle is never
        given a substitute serial."""
        self.state = state

    def observe(
        self,
        machine: MachineState,
        scanner: ScannerState,
        machine_id: str,
        capture_macros: Callable[[], dict[str, Decimal]],
        timestamp: str,
        capture_argonaut: Callable[[], dict[str, str | None]] | None = None,
    ) -> None:
        """`capture_argonaut` (when Argonaut is enabled) reads its macros by number at completion."""
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
            # Macro values are captured once, at completion, and never re-read on retry. Both reads
            # happen before the state changes, so a failed read leaves the cycle to retry intact.
            macros = {key: str(value) for key, value in capture_macros().items()}
            argonaut = capture_argonaut() if capture_argonaut is not None else None
            active.macros = macros
            active.completed_at = timestamp
            state.pending_cycles.append(active)
            if argonaut is not None:
                state.argonaut_pending.append(ArgonautPost(
                    cycle_id=active.id, serial=active.serial, part_number=active.part_number,
                    consec=active.consec, completed_at=timestamp, values=argonaut,
                ))
            state.active_cycle = None
        state.scanner_serial = scanner.serial
        state.queued_serial = queued
        state.was_in_cycle = machine.in_cycle
