import tempfile
import threading
import time
import unittest

from lapper_read.config import Settings
from lapper_read.supervisor import MachineSpec, Supervisor, desired_machines


def machine(mid, ip="10.16.81.15", status="Active", scanner_ip="10.16.80.57", number=None):
    scanner = {"id": "s-" + mid, "ip": scanner_ip, "status": "Active", "machine_id": mid} if scanner_ip else None
    return {"id": mid, "number": number or mid, "ip": ip, "status": status, "cell": "1", "scanner": scanner}


class DesiredMachinesTests(unittest.TestCase):
    def test_active_machine_with_controller_ip_and_scanner_gets_a_worker(self):
        wanted, skipped = desired_machines([machine("m1")], [])
        self.assertEqual(wanted["m1"], MachineSpec("m1", "m1", "10.16.81.15", "10.16.80.57", "1"))
        self.assertEqual(skipped, {})

    def test_reasons_for_machines_without_a_worker(self):
        _, skipped = desired_machines([
            machine("off", status="Inactive"),
            machine("noip", ip=""),
            machine("noscan", scanner_ip=None),
        ], [])
        self.assertEqual(skipped["off"], ("off", "machine is inactive"))
        self.assertEqual(skipped["noip"][1], "no FANUC controller IP")
        self.assertIn("no scanner", skipped["noscan"][1])

    def test_scanner_can_come_from_the_scanner_list(self):
        m = machine("m1", scanner_ip=None)
        wanted, _ = desired_machines([m], [{"id": "s1", "ip": "10.0.0.9", "status": "Active", "machine_id": "m1"}])
        self.assertEqual(wanted["m1"].scanner_ip, "10.0.0.9")


class FakeWorker:
    def __init__(self, spec, fail=False):
        self.spec, self.fail = spec, fail
        self.stopped = threading.Event()
        self.phase, self.last_error = "collecting", None

    def run(self):
        if self.fail:
            raise RuntimeError("checkpoint locked")
        self.stopped.wait(5)

    def stop(self, *_):
        self.stopped.set()

    def status(self):
        return {"phase": self.phase}


class FakeApi:
    def __init__(self):
        self.machines = []

    def request(self, method, path, *args, **kwargs):
        return self.machines if path.endswith("/machine") else []


class SupervisorTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.settings = Settings(machine_ip="", scanner_ip="", state_dir=self.dir.name, retry_delay_ms=10,
                                 api_email="a", api_password="b", status_port=0)
        self.api, self.built = FakeApi(), []
        self.fail_next = False

        def factory(spec):
            worker = FakeWorker(spec, fail=self.fail_next)
            self.built.append(worker)
            return worker

        self.supervisor = Supervisor(self.settings, self.api, factory)

    def tearDown(self):
        for slot in self.supervisor._slots.values():
            slot.stop()
        self.dir.cleanup()

    def _wait(self, predicate):
        end = time.monotonic() + 10
        while time.monotonic() < end and not predicate():
            time.sleep(0.01)
        self.assertTrue(predicate())

    def test_saving_a_machine_starts_its_worker(self):
        self.supervisor.discover_once()
        self.assertEqual(self.built, [])
        self.api.machines = [machine("m1")]
        self.supervisor.discover_once()
        self._wait(lambda: len(self.built) == 1)
        self.assertEqual(self.built[0].spec.controller_ip, "10.16.81.15")
        self.assertEqual([w["machine_id"] for w in self.supervisor.status()["workers"]], ["m1"])

    def test_changing_the_controller_ip_restarts_only_that_worker(self):
        self.api.machines = [machine("m1"), machine("m2", ip="10.16.81.16")]
        self.supervisor.discover_once()
        self._wait(lambda: len(self.built) == 2)
        self.api.machines = [machine("m1", ip="10.16.81.99"), machine("m2", ip="10.16.81.16")]
        self.supervisor.discover_once()
        self._wait(lambda: len(self.built) == 3)
        old = next(w for w in self.built if w.spec.machine_id == "m1" and w.spec.controller_ip == "10.16.81.15")
        self.assertTrue(old.stopped.is_set())
        self.assertFalse(next(w for w in self.built if w.spec.machine_id == "m2").stopped.is_set())

    def test_inactive_or_deleted_machines_stop_their_worker(self):
        self.api.machines = [machine("m1")]
        self.supervisor.discover_once()
        self._wait(lambda: len(self.built) == 1)
        self.api.machines = [machine("m1", status="Inactive")]
        self.supervisor.discover_once()
        self.assertTrue(self.built[0].stopped.is_set())
        self.assertEqual(self.supervisor.status()["workers"], [])
        self.assertEqual(self.supervisor.status()["machines_without_worker"][0]["reason"], "machine is inactive")
        summary = self.supervisor.summary()["machines"]
        self.assertEqual(summary, [{"machine_id": "m1", "worker": False, "phase": "machine is inactive"}])
        self.assertNotIn("10.16", str(summary))

    def test_a_failing_worker_is_rebuilt_without_affecting_others(self):
        self.fail_next = True
        self.api.machines = [machine("m1")]
        self.supervisor.discover_once()
        self._wait(lambda: len(self.built) >= 2)  # rebuilt after the failure
        self.fail_next = False
        self._wait(lambda: self.supervisor.status()["workers"][0]["restarts"] >= 1)

    def test_state_file_follows_the_machine_id_not_the_ip(self):
        from dataclasses import replace
        s = replace(self.settings, machine_ip="10.16.81.15", state_key="9d9e0c7d-uuid")
        self.assertTrue(s.state_file.endswith("machine-9d9e0c7d-uuid.json"))


if __name__ == "__main__":
    unittest.main()
