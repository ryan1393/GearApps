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


class CycleTimeTests(unittest.TestCase):
    START, END, DOOR = "2026-11-10T03:00:00.000Z", "2026-11-10T03:02:04.250Z", "2026-11-10T03:02:30.000Z"

    def argonaut(self):
        return {"10039": "1"}

    def test_cycle_time_runs_from_going_into_cycle_to_coming_out_of_it(self):
        t = CycleTracker(CycleState(was_in_cycle=False))
        t.observe(machine(door=True, start=True, cycle=True), ScannerState(None, "SN-1"), "m", capture, self.START,
                  self.argonaut)
        t.observe(machine(door=True), ScannerState(None, None), "m", capture, self.END, self.argonaut)
        self.assertEqual(t.state.argonaut_pending, [])  # the door is still closed
        t.observe(machine(), ScannerState(None, None), "m", capture, self.DOOR, self.argonaut)
        self.assertEqual(t.state.pending_cycles[0].cycle_time_s(), 124.25)
        self.assertEqual(t.state.argonaut_pending[0].cycle_time_s, 124.25)

    def test_coming_out_of_cycle_and_opening_the_door_together_ends_the_cycle_there(self):
        t = CycleTracker(CycleState(was_in_cycle=False))
        t.observe(machine(door=True, start=True, cycle=True), ScannerState(None, "SN-1"), "m", capture, self.START,
                  self.argonaut)
        t.observe(machine(), ScannerState(None, None), "m", capture, self.END, self.argonaut)
        self.assertEqual(t.state.argonaut_pending[0].cycle_time_s, 124.25)

    def test_a_cycle_already_running_at_start_up_has_no_cycle_time(self):
        t = CycleTracker(CycleState())
        t.observe(machine(door=True, cycle=True), ScannerState(None, None), "m", capture, self.START, self.argonaut)
        t.observe(machine(), ScannerState(None, None), "m", capture, self.END, self.argonaut)
        self.assertIsNone(t.state.argonaut_pending[0].cycle_time_s)


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

    def test_cycle_times_survive_a_restart_and_older_checkpoints_still_load(self):
        t = CycleTracker(CycleState(was_in_cycle=False))
        t.observe(machine(door=True, start=True, cycle=True), ScannerState(None, "SN-1"), "m", capture,
                  "2026-11-10T03:00:00.000Z", lambda: {"10039": "1"})
        t.observe(machine(), ScannerState(None, None), "m", capture, "2026-11-10T03:01:30.500Z", lambda: {"10039": "1"})
        store = CycleStateStore(self.path)
        store.save(t.state)
        restored = store.load()
        self.assertEqual(restored.pending_cycles[0].cycle_time_s(), 90.5)
        self.assertEqual(restored.argonaut_pending[0].cycle_time_s, 90.5)

        raw = json.loads(open(self.path).read())
        for cycle in raw["pending_cycles"]:
            del cycle["cycle_started_at"], cycle["cycle_ended_at"]
        for post in raw["argonaut_pending"]:
            del post["cycle_time_s"]
        with open(self.path, "w") as handle:
            json.dump(raw, handle)
        older = store.load()
        self.assertIsNone(older.pending_cycles[0].cycle_time_s())
        self.assertIsNone(older.argonaut_pending[0].cycle_time_s)

    def test_corrupt_checkpoint_fails_instead_of_discarding_records(self):
        with open(self.path, "w") as handle:
            handle.write("{not json")
        with self.assertRaises(InvalidCheckpoint):
            CycleStateStore(self.path).load()

    def test_pending_cycle_without_serial_survives_a_restart(self):
        # A machine with no scanner records cycles without a serial. Rejecting one here left
        # its worker restarting forever after the collector was restarted.
        with open(self.path, "w") as handle:
            json.dump({"pending_cycles": [{"machine_id": "m", "part_number": 1, "consec": 1,
                                           "started_at": NOW, "completed_at": NOW, "serial": None}]}, handle)
        restored = CycleStateStore(self.path).load()
        self.assertIsNone(restored.pending_cycles[0].serial)

    def test_pending_cycle_without_completion_time_is_rejected(self):
        with open(self.path, "w") as handle:
            json.dump({"pending_cycles": [{"machine_id": "m", "part_number": 1, "consec": 1,
                                           "started_at": NOW, "completed_at": None, "serial": "D1"}]}, handle)
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
