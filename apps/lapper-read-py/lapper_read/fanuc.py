"""Machine reads (ident, consec, PMC signals, macros) and change-only macro publishing."""

from __future__ import annotations

import logging
import math
import threading
from decimal import Decimal
from typing import Protocol

from .api import ApiError
from .focas import PMC_X, PMC_Y
from .state import MachineState

log = logging.getLogger(__name__)

MACRO_IDENT = 10020  # gearset / part number
MACRO_CONSEC = 10032  # consecutive cycle counter


class Transport(Protocol):
    def open(self, ip: str, timeout_s: int) -> int: ...
    def close(self, handle: int) -> None: ...
    def read_macro(self, handle: int, number: int) -> Decimal | None: ...
    def read_pmc_bit(self, handle: int, address_type: int, byte: int, bit: int) -> bool: ...


class NoGearsetLoaded(IOError):
    """The control answers, but #10020 (gearset) or #10032 (consec) is 0: no lapping program is
    loaded, so there is no cycle to record yet."""


class Fanuc:
    def __init__(self, transport: Transport, machine_ip: str, io_timeout_ms: int, api):
        self._transport, self._ip, self._api = transport, machine_ip, api
        self._timeout_s = max(1, math.ceil(io_timeout_ms / 1000))
        self._handle: int | None = None
        self._lock = threading.Lock()
        self._macros: list[dict] = []
        self._baselines: dict[tuple[str, str], dict[str, Decimal]] = {}

    def initialize(self) -> None:
        self._macros = self._api.macros()

    def close(self) -> None:
        with self._lock:
            self._drop()

    def release_thread(self) -> None:
        exit_thread = getattr(self._transport, "exit_thread", None)
        if exit_thread:
            try:
                exit_thread()
            except Exception:  # noqa: BLE001
                log.debug("FOCAS thread release failed", exc_info=True)

    def _drop(self) -> None:
        if self._handle is not None:
            try:
                self._transport.close(self._handle)
            except Exception:  # noqa: BLE001 - closing a dead handle must not mask the real error
                pass
            self._handle = None

    def _read(self, operation):
        with self._lock:
            try:
                if self._handle is None:
                    self._handle = self._transport.open(self._ip, self._timeout_s)
                return operation(self._handle)
            except Exception:
                self._drop()  # reconnect on the next read; never report a failed read as false
                raise

    def macro(self, number: int) -> Decimal | None:
        return self._read(lambda handle: self._transport.read_macro(handle, number))

    def read_state(self) -> MachineState:
        ident, consec = self.macro(MACRO_IDENT), self.macro(MACRO_CONSEC)
        if not _counter(ident) or not _counter(consec):
            raise NoGearsetLoaded(
                f"No gearset loaded: #{MACRO_IDENT}={ident} #{MACRO_CONSEC}={consec} (load a program to start collecting)."
            )
        return MachineState(
            ident=int(ident),
            consec=int(consec),
            door_closed=self._read(lambda h: self._transport.read_pmc_bit(h, PMC_X, 6, 7)),
            start_cycle=self._read(lambda h: self._transport.read_pmc_bit(h, PMC_X, 1, 2)),
            in_cycle=self._read(lambda h: self._transport.read_pmc_bit(h, PMC_Y, 3, 2)),
        )

    def capture_macros(self) -> dict[str, Decimal]:
        values: dict[str, Decimal] = {}
        missing: list[str] = []
        for macro in self._macros:
            value = self.macro(int(macro["number"]))
            if value is None:
                missing.append(f"#{macro['number']}")
            else:
                values[macro["id"]] = value
        if missing:
            shown = ", ".join(missing[:10]) + (f" and {len(missing) - 10} more" if len(missing) > 10 else "")
            log.warning("%d macros are unavailable on the controller (%s); their previous values are kept",
                        len(missing), shown)
        return values

    def capture_numbers(self, numbers) -> dict[str, str | None]:
        """Reads macros by number (e.g. Argonaut's list); an unavailable macro is None."""
        values: dict[str, str | None] = {}
        for number in numbers:
            value = self.macro(int(number))
            values[str(number)] = None if value is None else str(value)
        return values

    def persist_macros(self, cycle: dict, values: dict[str, Decimal], request_id: str) -> int:
        """Posts only macros that changed since the last run of this gearset on this machine."""
        key = (cycle["machine_id"], cycle["gearset_id"])
        baseline = self._baselines.get(key)
        if baseline is None:
            previous = self._api.lapping_summary(*key)
            baseline = {row["macro_id"]: Decimal(str(row["value"])) for row in previous if "macro_id" in row}
            self._baselines[key] = baseline
        written = 0
        for macro_id, value in values.items():
            if baseline.get(macro_id) == value:
                continue
            try:
                self._api.post_macro_log(cycle["id"], macro_id, value, f"{request_id}:{macro_id}")
            except ApiError as error:
                if not error.permanent:
                    raise  # outage, sign-in, throttling: the whole cycle is retried
                # The API refused this value (e.g. outside numeric(13,5)); sending it again cannot
                # succeed. Skip it, keep its old baseline, and record the rest of the cycle.
                log.warning("[%s] MeshForge refused macro %s = %s for cycle %s; skipped: %s",
                            cycle["machine_id"], self._macro_label(macro_id), value, cycle["id"], error)
                continue
            baseline[macro_id] = value  # only acknowledged values advance the baseline
            written += 1
        return written

    def _macro_label(self, macro_id: str) -> str:
        number = next((m.get("number") for m in self._macros if m.get("id") == macro_id), None)
        return f"#{number} ({macro_id})" if number is not None else macro_id


def _counter(value: Decimal | None) -> bool:
    return value is not None and 0 < value <= 2**31 - 1 and value == value.to_integral_value()
