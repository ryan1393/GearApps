"""Turns machine and scanner samples into cycles, without network calls."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from decimal import Decimal

from .state import ArgonautPost, CycleState, MachineState, PendingCycle, ScannerState, parse_timestamp

#: An in-cycle start or end is only timed when the previous sample was at most this long before it.
DEFAULT_MAX_SAMPLE_GAP_S = 2.0


class CycleTracker:
    def __init__(self, state: CycleState, max_sample_gap_s: float = DEFAULT_MAX_SAMPLE_GAP_S):
        """Every completed cycle is recorded: with the confirmed scanned serial when there is one,
        otherwise with no serial (no scanner, scanner offline, or nothing scanned). A cycle is never
        given a substitute serial.

        `max_sample_gap_s`: a change into or out of cycle is only timed when the previous sample was
        this recent. After a collector restart (no previous sample yet) or a spell with the controller
        unreachable, the change happened at some unknown moment in the gap, so the cycle gets no
        cycle time (sent to Argonaut as 0) rather than a wrong one."""
        self.state = state
        self.max_sample_gap_s = max_sample_gap_s
        self._previous_sample_at: datetime | None = None

    def _edge_is_timed(self, timestamp: str) -> bool:
        """Whether a change seen in this sample happened within `max_sample_gap_s` of now."""
        try:
            now = parse_timestamp(timestamp)
        except ValueError:
            self._previous_sample_at = None
            return False
        previous, self._previous_sample_at = self._previous_sample_at, now
        return previous is not None and 0 <= (now - previous).total_seconds() <= self.max_sample_gap_s

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
        edge_timed = self._edge_is_timed(timestamp)
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
                # Only a cycle seen going from out of cycle into cycle, by a sample right after the
                # previous one, has a known start (and so a cycle time). After a collector start or a
                # gap in sampling it may already have been running a while.
                cycle_started_at=timestamp if state.was_in_cycle is False and edge_timed else None,
            )
            if serial:
                queued = None  # the queued part is now the one in process
        if state.active_cycle is not None and state.was_in_cycle is True and not machine.in_cycle:
            # Out of cycle: the cycle time runs to here, not to the door opening. A cycle that goes
            # back into cycle before the door opens (e.g. a restart) runs to its last end. An end
            # seen only after a gap in sampling happened at an unknown moment, so it is not timed.
            state.active_cycle.cycle_ended_at = timestamp if edge_timed else None
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
                    cycle_time_s=active.cycle_time_s(),
                ))
            state.active_cycle = None
        state.scanner_serial = scanner.serial
        state.queued_serial = queued
        state.was_in_cycle = machine.in_cycle
