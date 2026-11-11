import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
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


def at(seconds: float) -> str:
    """A sample time, `seconds` after 03:00:00 UTC."""
    return (datetime(2026, 11, 10, 3, tzinfo=timezone.utc) + timedelta(seconds=seconds)).isoformat(
        timespec="milliseconds").replace("+00:00", "Z")


def argonaut_values():
    return {"10039": "1"}


def run(tracker, *spans, start=0.0, step=1.0):
    """Samples the machine every `step` seconds: each span is (machine state, seconds it lasts)."""
    clock = start
    for state, seconds in spans:
        end = clock + seconds
        while clock < end:
            tracker.observe(state, ScannerState(None, "SN-1"), "m", capture, at(clock), argonaut_values)
            clock += step
    return clock


IDLE, LOADED, RUNNING, DONE, OPEN = (machine(), machine(door=True), machine(door=True, start=True, cycle=True),
                                     machine(door=True), machine())


class CycleTimeTests(unittest.TestCase):
    def test_cycle_time_runs_from_going_into_cycle_to_coming_out_of_it(self):
        t = CycleTracker(CycleState(was_in_cycle=False))
        # In cycle from 10s to 134s; the door opens at 160s, which is not counted.
        run(t, (IDLE, 5), (LOADED, 5), (RUNNING, 124), (DONE, 26), (OPEN, 1))
        self.assertEqual(t.state.pending_cycles[0].cycle_time_s(), 124.0)
        self.assertEqual(t.state.argonaut_pending[0].cycle_time_s, 124.0)

    def test_coming_out_of_cycle_and_opening_the_door_together_ends_the_cycle_there(self):
        t = CycleTracker(CycleState(was_in_cycle=False))
        run(t, (LOADED, 2), (RUNNING, 90.25, ), (OPEN, 1), step=0.25)
        self.assertEqual(t.state.argonaut_pending[0].cycle_time_s, 90.25)

    def test_a_cycle_already_running_at_start_up_has_no_cycle_time(self):
        t = CycleTracker(CycleState())
        run(t, (machine(door=True, cycle=True), 30), (OPEN, 1))
        self.assertIsNone(t.state.argonaut_pending[0].cycle_time_s)

    def test_a_start_or_end_missed_while_the_collector_was_down_has_no_cycle_time(self):
        # Down when the cycle started: the restarted collector's first sample is already in cycle.
        started_unseen = CycleTracker(CycleState(was_in_cycle=False))
        run(started_unseen, (RUNNING, 60), (OPEN, 1), start=100)
        self.assertIsNone(started_unseen.state.argonaut_pending[0].cycle_time_s)

        # Down when the cycle ended: the checkpoint says in cycle, the first sample says out of it.
        before = CycleTracker(CycleState(was_in_cycle=False))
        run(before, (LOADED, 2), (RUNNING, 30))
        ended_unseen = CycleTracker(before.state)  # a new tracker, as after a restart
        run(ended_unseen, (DONE, 5), (OPEN, 1), start=300)
        self.assertIsNone(ended_unseen.state.argonaut_pending[0].cycle_time_s)

    def test_a_restart_in_the_middle_of_a_cycle_keeps_its_time_when_both_ends_were_seen(self):
        before = CycleTracker(CycleState(was_in_cycle=False))
        run(before, (LOADED, 2), (RUNNING, 30))
        after = CycleTracker(before.state)
        run(after, (RUNNING, 30), (OPEN, 1), start=40)  # 8s gap while restarting, mid-cycle
        self.assertEqual(after.state.argonaut_pending[0].cycle_time_s, 68.0)

    def test_an_end_seen_only_after_a_gap_in_sampling_has_no_cycle_time(self):
        t = CycleTracker(CycleState(was_in_cycle=False))
        clock = run(t, (LOADED, 2), (RUNNING, 30))
        # The controller stops answering for 20 seconds; when it answers the cycle is over.
        run(t, (DONE, 5), (OPEN, 1), start=clock + 20)
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
        run(t, (LOADED, 1), (RUNNING, 90.5), (OPEN, 0.5), step=0.5)
        store = CycleStateStore(self.path)
        store.save(t.state)
        restored = store.load()
        self.assertEqual(restored.pending_cycles[0].cycle_time_s(), 90.5)
        self.assertEqual(restored.argonaut_pending[0].cycle_time_s, 90.5)

        with open(self.path, encoding="utf-8") as handle:
            raw = json.load(handle)
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
