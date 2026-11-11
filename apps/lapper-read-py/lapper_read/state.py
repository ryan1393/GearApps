"""Cycle state checkpointed to disk so a restart never loses or re-assigns a run."""

from __future__ import annotations

import fcntl
import json
import os
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class MachineState:
    ident: int
    consec: int
    door_closed: bool
    start_cycle: bool
    in_cycle: bool


@dataclass(frozen=True)
class ScannerState:
    serial: str | None
    queue: str | None


@dataclass
class PendingCycle:
    machine_id: str
    part_number: int
    consec: int
    started_at: str
    serial: str | None = None
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    completed_at: str | None = None
    macros: dict[str, str] = field(default_factory=dict)  # macro id -> decimal text
    saved_cycle: dict[str, Any] | None = None
    #: When the machine was seen going into cycle (Y3.2 on). None when the collector started (or
    #: was upgraded) part-way through the cycle, so its start, and its cycle time, are unknown.
    cycle_started_at: str | None = None
    #: When the machine last came out of cycle (Y3.2 off) before the door opened.
    cycle_ended_at: str | None = None

    def macro_values(self) -> dict[str, Decimal]:
        return {key: Decimal(value) for key, value in self.macros.items()}

    def cycle_time_s(self) -> float | None:
        """Seconds the machine was in cycle, from going into cycle to coming out of it, or None
        when either edge was not seen."""
        return cycle_seconds(self.cycle_started_at, self.cycle_ended_at)


def cycle_seconds(started_at: str | None, ended_at: str | None) -> float | None:
    if not started_at or not ended_at:
        return None
    try:
        seconds = (_instant(ended_at) - _instant(started_at)).total_seconds()
    except ValueError:
        return None
    return round(seconds, 3) if seconds >= 0 else None


def _instant(text: str) -> datetime:
    # utc_now() writes a trailing Z, which datetime.fromisoformat only accepts from Python 3.11.
    return datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)


@dataclass
class ArgonautPost:
    """A completed cycle waiting to be sent to Argonaut; kept apart from MeshForge's queue so an
    Argonaut outage never holds up recording cycles."""

    cycle_id: str
    serial: str | None
    part_number: int
    consec: int
    completed_at: str
    values: dict[str, str | None] = field(default_factory=dict)  # macro number -> decimal text
    attempts: int = 0
    #: Seconds in cycle, sent as floatData[0]; None (sent as 0) when it could not be measured.
    cycle_time_s: float | None = None


@dataclass
class CycleState:
    was_in_cycle: bool | None = None
    scanner_serial: str | None = None
    queued_serial: str | None = None
    active_cycle: PendingCycle | None = None
    pending_cycles: list[PendingCycle] = field(default_factory=list)
    argonaut_pending: list[ArgonautPost] = field(default_factory=list)

    def snapshot(self) -> tuple:
        return (
            self.was_in_cycle,
            self.scanner_serial,
            self.queued_serial,
            None if self.active_cycle is None else self.active_cycle.id,
            None if self.active_cycle is None else self.active_cycle.serial,
            tuple((c.id, c.saved_cycle is not None) for c in self.pending_cycles),
            tuple((p.cycle_id, p.attempts) for p in self.argonaut_pending),
        )


class InvalidCheckpoint(ValueError):
    pass


def _cycle(raw: dict[str, Any]) -> PendingCycle:
    try:
        cycle = PendingCycle(**raw)
        _instant(cycle.started_at)
        for moment in (cycle.completed_at, cycle.cycle_started_at, cycle.cycle_ended_at):
            if moment:
                _instant(moment)
        for value in cycle.macros.values():
            Decimal(value)
        return cycle
    except Exception as error:  # noqa: BLE001 - any malformed field invalidates the checkpoint
        raise InvalidCheckpoint(f"Invalid cycle record in checkpoint: {error}") from error


def _argonaut(raw: dict[str, Any]) -> ArgonautPost:
    try:
        post = ArgonautPost(**raw)
        if post.cycle_time_s is not None:
            post.cycle_time_s = float(post.cycle_time_s)
        for value in post.values.values():
            if value is not None:
                Decimal(value)
        return post
    except Exception as error:  # noqa: BLE001
        raise InvalidCheckpoint(f"Invalid Argonaut record in checkpoint: {error}") from error


class CycleStateStore:
    def __init__(self, path: str):
        self.path = os.path.abspath(path)
        self._lease = None

    def acquire_lease(self) -> None:
        """Only one collector may own a machine's checkpoint."""
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        handle = open(self.path + ".lock", "a+")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            handle.close()
            raise RuntimeError(f"Another collector already owns {self.path}") from error
        self._lease = handle

    def release_lease(self) -> None:
        if self._lease:
            fcntl.flock(self._lease, fcntl.LOCK_UN)
            self._lease.close()
            self._lease = None

    def load(self) -> CycleState:
        if not os.path.exists(self.path):
            return CycleState()
        with open(self.path, encoding="utf-8") as handle:
            try:
                raw = json.load(handle)
            except json.JSONDecodeError as error:
                # Never silently discard pending production records.
                raise InvalidCheckpoint(f"The cycle checkpoint is not valid JSON: {error}") from error
        if not isinstance(raw, dict) or not isinstance(raw.get("pending_cycles"), list):
            raise InvalidCheckpoint("The cycle checkpoint has no pending cycle list.")
        pending = [_cycle(item) for item in raw["pending_cycles"]]
        # A cycle with no serial is valid: machines without a scanner record every cycle that way.
        if any(not c.completed_at for c in pending):
            raise InvalidCheckpoint("A pending cycle in the checkpoint has no completion time.")
        active = _cycle(raw["active_cycle"]) if raw.get("active_cycle") else None
        return CycleState(
            was_in_cycle=raw.get("was_in_cycle"),
            scanner_serial=raw.get("scanner_serial"),
            queued_serial=raw.get("queued_serial"),
            active_cycle=active,
            pending_cycles=pending,
            argonaut_pending=[_argonaut(item) for item in raw.get("argonaut_pending") or []],
        )

    def save(self, state: CycleState) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        temporary = self.path + ".tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(asdict(state), handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, self.path)
        directory = os.open(os.path.dirname(self.path), os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
