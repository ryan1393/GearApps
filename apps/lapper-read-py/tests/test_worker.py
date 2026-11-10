import os
import tempfile
import threading
import time
import unittest
from decimal import Decimal

from lapper_read.config import Settings
from lapper_read.fanuc import Fanuc
from lapper_read.state import CycleStateStore, ScannerState
from lapper_read.worker import Worker
from tests.fakes import FakeApi, FakeTransport


class StubScanner:
    def __init__(self):
        self.state = ScannerState(None, None)
        self.fail = False

    def read(self, previous):
        if self.fail:
            raise OSError("scanner offline")
        return self.state

    def close(self):
        pass


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.settings = Settings(machine_ip="10.0.0.1", scanner_ip="10.0.0.2", state_dir=self.dir.name,
                                 poll_interval_ms=10, retry_delay_ms=20, api_email="a", api_password="b")
        self.transport, self.api, self.scanner = FakeTransport(), FakeApi(), StubScanner()
        self.worker = self._worker()

    def tearDown(self):
        self.worker.stop()
        self.dir.cleanup()

    def _worker(self):
        fanuc = Fanuc(self.transport, "10.0.0.1", 1000, self.api)
        return Worker(self.settings, self.api, fanuc, self.scanner, CycleStateStore(self.settings.state_file))

    def _start(self, worker):
        thread = threading.Thread(target=worker.run, daemon=True)
        thread.start()
        return thread

    def _wait(self, predicate, timeout=3):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if predicate():
                return
            time.sleep(0.01)
        self.fail("condition not reached")

    def _run_one_cycle(self, serial="D000000001", consec=1, rpm="1800"):
        self.transport.macros[10032] = Decimal(consec)
        self.transport.macros[11006] = Decimal(rpm)
        self.scanner.state = ScannerState(None, serial)
        time.sleep(0.08)
        self.transport.set_state(door=True, start=True, cycle=True)
        time.sleep(0.08)
        self.scanner.state = ScannerState(None, None)
        self.transport.set_state(door=False, start=False, cycle=False)

    def test_a_cycle_is_published_with_its_serial_and_changed_macros(self):
        thread = self._start(self.worker)
        self._run_one_cycle()
        self._wait(lambda: self.api.macro_logs)
        self._wait(lambda: any(c[0] == "io" for c in self.api.calls))
        self.worker.stop()
        thread.join(3)
        cycles = [c for c in self.api.calls if c[0] == "cycle"]
        self.assertEqual(cycles[0][1:3], ("D000000001", 1))
        self.assertEqual({v[1] for v in self.api.macro_logs.values()}, {"m-consec", "m-rpm"})
        self.assertTrue(os.path.exists(self.settings.heartbeat_file))

    def test_cycle_post_failure_is_retried_without_losing_the_serial(self):
        self.api.fail_cycle = 2
        thread = self._start(self.worker)
        self._run_one_cycle()
        self._wait(lambda: self.api.macro_logs)
        self.worker.stop()
        thread.join(3)
        posts = [c for c in self.api.calls if c[0] == "cycle"]
        self.assertEqual(len(posts), 3)
        self.assertEqual({(p[1], p[3]) for p in posts}, {(posts[0][1], posts[0][3])})  # same serial and key

    def test_macro_retry_does_not_recreate_an_acknowledged_cycle(self):
        self.api.fail_macro = {"m-rpm"}
        thread = self._start(self.worker)
        self._run_one_cycle()
        self._wait(lambda: any(v[1] == "m-rpm" for v in self.api.macro_logs.values()))
        self.worker.stop()
        thread.join(3)
        self.assertEqual(len([c for c in self.api.calls if c[0] == "cycle"]), 1)

    def test_restart_replays_the_checkpoint_without_reposting_a_saved_cycle(self):
        self.api.fail_macro = {"m-rpm", "m-consec"}
        original = self.api.post_macro_log
        self.api.post_macro_log = lambda *a: (_ for _ in ()).throw(IOError("API down"))
        thread = self._start(self.worker)
        self._run_one_cycle()
        self._wait(lambda: any(c[0] == "cycle" for c in self.api.calls))
        time.sleep(0.1)
        self.worker.stop()
        thread.join(3)
        self.api.post_macro_log = original
        self.api.fail_macro = set()
        restarted = self._worker()
        self.worker = restarted
        thread = self._start(restarted)
        self._wait(lambda: len(self.api.macro_logs) == 2)
        restarted.stop()
        thread.join(3)
        self.assertEqual(len([c for c in self.api.calls if c[0] == "cycle"]), 1)

    def test_scanner_outage_keeps_polling_the_machine(self):
        self.scanner.fail = True
        thread = self._start(self.worker)
        self._wait(lambda: os.path.exists(self.settings.heartbeat_file))
        self.worker.stop()
        thread.join(3)
        self.assertFalse(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
