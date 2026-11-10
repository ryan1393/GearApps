from __future__ import annotations

from decimal import Decimal

from lapper_read.state import MachineState


class FakeTransport:
    """Simulated controller: macro values and PMC bits are plain attributes."""

    def __init__(self):
        self.macros: dict[int, Decimal | None] = {10020: Decimal(373), 10032: Decimal(1)}
        self.bits = {(3, 6, 7): False, (3, 1, 2): False, (2, 3, 2): False}
        self.opens = self.closes = 0
        self.fail_pmc = False

    def set_state(self, door: bool, start: bool, cycle: bool) -> None:
        self.bits = {(3, 6, 7): door, (3, 1, 2): start, (2, 3, 2): cycle}

    def open(self, ip, timeout_s):
        self.opens += 1
        return 7

    def close(self, handle):
        self.closes += 1

    def read_macro(self, handle, number):
        return self.macros.get(number)

    def read_pmc_bit(self, handle, address_type, byte, bit):
        if self.fail_pmc:
            raise IOError("FANUC read PMC failed (code -16).")
        return self.bits[(address_type, byte, bit)]


class FakeApi:
    def __init__(self):
        self.calls: list[tuple] = []
        self.cycles: dict[str, dict] = {}  # idempotency key -> saved cycle
        self.macro_logs: dict[str, tuple] = {}  # idempotency key -> (cycle, macro, value)
        self.fail_cycle = 0
        self.fail_macro: set[str] = set()
        self.summary: list[dict] = []

    def macros(self):
        return [{"id": "m-consec", "number": 10032}, {"id": "m-rpm", "number": 11006}, {"id": "m-missing", "number": 19999}]

    def machine_by_ip(self, ip, number):
        return {"id": "machine-1", "number": "01-094-101"}

    def scanner_by_ip(self, ip):
        return {"id": "scanner-1", "machine_id": "machine-1"}

    def fanuc_variables(self, machine_id):
        return {"id": "vars-1"}

    def gearset_by_number(self, part_number):
        self.calls.append(("gearset", part_number))
        return {"id": f"gs-{part_number}"}

    def post_cycle(self, serial, consec, machine_id, gearset_id, completed_at, key):
        self.calls.append(("cycle", serial, consec, key))
        if self.fail_cycle:
            self.fail_cycle -= 1
            raise IOError("API down")
        return self.cycles.setdefault(key, {"id": f"cycle-{len(self.cycles) + 1}"})

    def post_macro_log(self, cycle_id, macro_id, value, key):
        self.calls.append(("macro", cycle_id, macro_id, value))
        if macro_id in self.fail_macro:
            self.fail_macro.discard(macro_id)
            raise IOError("API down")
        self.macro_logs[key] = (cycle_id, macro_id, value)
        return {"id": key}

    def lapping_summary(self, machine_id, gearset_id):
        self.calls.append(("summary", machine_id, gearset_id))
        return self.summary

    def patch_scanner_serials(self, *args):
        self.calls.append(("serials",) + args)
        return {"id": "scanner-1"}

    def patch_fanuc_variables(self, *args):
        self.calls.append(("io",) + args)
        return {"id": "vars-1"}


def machine(door=False, start=False, cycle=False, ident=373, consec=1) -> MachineState:
    return MachineState(ident, consec, door, start, cycle)
