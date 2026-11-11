import json
import os
import tempfile
import unittest
from decimal import Decimal

from lapper_read.state import CycleState, CycleStateStore, InvalidCheckpoint, ScannerState
from lapper_read.tracker import CycleTracker
from tests.fakes import machine

NOW = "2026-11-10T03:00:00.000Z"


def capture():
    return {"m-rpm": Decimal("1800.5")}


class TrackerTests(unittest.TestCase):
    def test_active_serial_is_latched_while_the_next_part_queues(self):
        t = CycleTracker(CycleState(was_in_cycle=False))
        t.observe(machine(door=True, start=True, cycle=True), ScannerState(None, "D000000001"), "m", capture, NOW)
        self.assertEqual(t.state.active_cycle.serial, "D000000001")
        self.assertIsNone(t.state.queued_serial)
        t.observe(machine(door=True, cycle=True), ScannerState(None, "D000000002"), "m", capture, NOW)
        self.assertEqual(t.state.active_cycle.serial, "D000000001")
        self.assertEqual(t.state.queued_serial, "D000000002")
        t.observe(machine(), ScannerState(None, "D000000002"), "m", capture, NOW)
        self.assertEqual([c.serial for c in t.state.pending_cycles], ["D000000001"])
        self.assertEqual(t.state.pending_cycles[0].macros, {"m-rpm": "1800.5"})

    def test_a_cycle_without_a_scan_is_recorded_without_a_serial_never_a_substitute(self):
        t = CycleTracker(CycleState(was_in_cycle=False, scanner_serial="D000000007"))
        t.observe(machine(door=True, start=True, cycle=True), ScannerState("D000000007", None), "m", capture, NOW)
        t.observe(machine(), ScannerState("D000000007", None), "m", capture, NOW)
        self.assertEqual([c.serial for c in t.state.pending_cycles], [None])

    def test_without_a_scanner_every_completed_cycle_is_kept_without_a_serial(self):
        t = CycleTracker(CycleState(was_in_cycle=False))
        t.observe(machine(door=True, start=True, cycle=True, consec=7), ScannerState(None, None), "m", capture, NOW)
        t.observe(machine(consec=7), ScannerState(None, None), "m", capture, NOW)
        self.assertEqual([(c.serial, c.consec) for c in t.state.pending_cycles], [(None, 7)])
        self.assertEqual(t.state.pending_cycles[0].macros, {"m-rpm": "1800.5"})

    def test_starting_during_a_cycle_does_not_consume_the_next_serial(self):
        t = CycleTracker(CycleState())  # unknown previous state, e.g. first poll after start-up
        t.observe(machine(door=True, start=True, cycle=True), ScannerState(None, "D000000009"), "m", capture, NOW)
        self.assertIsNone(t.state.active_cycle.serial)
        self.assertEqual(t.state.queued_serial, "D000000009")


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "10.0.0.1.json")

    def tearDown(self):
        self.dir.cleanup()

    def test_checkpoint_restores_active_and_pending_cycles(self):
        t = CycleTracker(CycleState(was_in_cycle=False))
        t.observe(machine(door=True, start=True, cycle=True), ScannerState(None, "D000000001"), "m", capture, NOW)
        t.observe(machine(), ScannerState(None, None), "m", capture, NOW)
        t.state.pending_cycles[0].saved_cycle = {"id": "c1", "machine_id": "m", "gearset_id": "g"}
        store = CycleStateStore(self.path)
        store.save(t.state)
        restored = store.load()
        self.assertEqual(restored.pending_cycles[0].serial, "D000000001")
        self.assertEqual(restored.pending_cycles[0].saved_cycle["id"], "c1")
        self.assertEqual(restored.pending_cycles[0].macro_values(), {"m-rpm": Decimal("1800.5")})

    def test_corrupt_checkpoint_fails_instead_of_discarding_records(self):
        with open(self.path, "w") as handle:
            handle.write("{not json")
        with self.assertRaises(InvalidCheckpoint):
            CycleStateStore(self.path).load()

    def test_pending_cycle_without_serial_is_rejected(self):
        with open(self.path, "w") as handle:
            json.dump({"pending_cycles": [{"machine_id": "m", "part_number": 1, "consec": 1,
                                           "started_at": NOW, "completed_at": NOW, "serial": None}]}, handle)
        with self.assertRaises(InvalidCheckpoint):
            CycleStateStore(self.path).load()

    def test_two_collectors_cannot_lease_the_same_checkpoint(self):
        first, second = CycleStateStore(self.path), CycleStateStore(self.path)
        first.acquire_lease()
        try:
            with self.assertRaises(RuntimeError):
                second.acquire_lease()
        finally:
            first.release_lease()
        second.acquire_lease()
        second.release_lease()


if __name__ == "__main__":
    unittest.main()
