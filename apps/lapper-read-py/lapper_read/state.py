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

    def macro_values(self) -> dict[str, Decimal]:
        return {key: Decimal(value) for key, value in self.macros.items()}


@dataclass
class CycleState:
    was_in_cycle: bool | None = None
    scanner_serial: str | None = None
    queued_serial: str | None = None
    active_cycle: PendingCycle | None = None
    pending_cycles: list[PendingCycle] = field(default_factory=list)

    def snapshot(self) -> tuple:
        return (
            self.was_in_cycle,
            self.scanner_serial,
            self.queued_serial,
            None if self.active_cycle is None else self.active_cycle.id,
            None if self.active_cycle is None else self.active_cycle.serial,
            tuple((c.id, c.saved_cycle is not None) for c in self.pending_cycles),
        )


class InvalidCheckpoint(ValueError):
    pass


def _cycle(raw: dict[str, Any]) -> PendingCycle:
    try:
        cycle = PendingCycle(**raw)
        datetime.fromisoformat(cycle.started_at)
        if cycle.completed_at:
            datetime.fromisoformat(cycle.completed_at)
        for value in cycle.macros.values():
            Decimal(value)
        return cycle
    except Exception as error:  # noqa: BLE001 - any malformed field invalidates the checkpoint
        raise InvalidCheckpoint(f"Invalid cycle record in checkpoint: {error}") from error


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
