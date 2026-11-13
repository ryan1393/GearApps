import tempfile
import threading
import time
import unittest

from lapper_read.config import Settings
from lapper_read.supervisor import ArgonautOverride, MachineSpec, Supervisor, desired_machines, with_machine_argonaut


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
        ], [])
        self.assertEqual(skipped["off"], ("off", "machine is inactive"))
        self.assertEqual(skipped["noip"][1], "no FANUC controller IP")

    def test_a_machine_without_an_active_scanner_still_gets_a_worker(self):
        inactive = machine("inactive")
        inactive["scanner"]["status"] = "Inactive"
        wanted, skipped = desired_machines([machine("noscan", scanner_ip=None), inactive], [])
        self.assertEqual(skipped, {})
        self.assertEqual(wanted["noscan"], MachineSpec("noscan", "noscan", "10.16.81.15", "", "1"))
        self.assertEqual(wanted["inactive"].scanner_ip, "")

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
        return {"phase": self.phase, "photoeye": True, "scanner_inputs": {"1": True, "2": False},
                "scanner_outputs": {"1": True}, "scanner_outputs_set_at": "2026-11-12T23:00:00.000Z"}

    def scanner_command(self, op, timeout_s=20.0):
        from lapper_read.worker import ScannerCommandError
        if self.fail:
            raise ScannerCommandError("scanner 10.16.80.57: timed out")
        return "OK," + op

    def read_macros(self, numbers, timeout_s=15.0):
        from lapper_read.worker import MacroReadError
        if self.fail:
            raise MacroReadError("the controller did not answer within 15s")
        return {str(n): ("373" if n == 10020 else None) for n in numbers}


class FakeApi:
    def __init__(self):
        self.machines = []
        self.argonaut = None
        self.argonaut_error = None

    def is_collector_token(self, presented):
        return presented == "glr_good"

    def argonaut_settings(self):
        if self.argonaut_error:
            raise self.argonaut_error
        return self.argonaut

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

    def test_the_ui_summary_carries_the_photoeye_for_the_live_view(self):
        self.api.machines = [machine("m1")]
        self.supervisor.discover_once()
        self._wait(lambda: self.supervisor.summary()["machines"][0].get("photoeye") is True)
        row = self.supervisor.summary()["machines"][0]
        self.assertEqual(row["scanner_inputs"], {"1": True, "2": False})
        self.assertEqual(row["scanner_outputs"], {"1": True})

    def test_a_failing_worker_is_rebuilt_without_affecting_others(self):
        self.fail_next = True
        self.api.machines = [machine("m1")]
        self.supervisor.discover_once()
        self._wait(lambda: len(self.built) >= 2)  # rebuilt after the failure
        self.fail_next = False
        self._wait(lambda: self.supervisor.status()["workers"][0]["restarts"] >= 1)

    def test_a_restarting_worker_reports_why_without_raw_error_text(self):
        self.fail_next = True
        self.api.machines = [machine("m1")]
        self.supervisor.discover_once()
        self._wait(lambda: self.supervisor.summary()["machines"][0]["phase"] == "restarting")
        row = self.supervisor.summary()["machines"][0]
        self.assertGreaterEqual(row["restarts"], 1)
        self.assertIn(row["problem"], ("unexpected error", "FANUC library or state folder not usable"))
        self.assertNotIn("last_error", row)

    def test_state_file_follows_the_machine_id_not_the_ip(self):
        from dataclasses import replace
        s = replace(self.settings, machine_ip="10.16.81.15", state_key="9d9e0c7d-uuid")
        self.assertTrue(s.state_file.endswith("machine-9d9e0c7d-uuid.json"))


if __name__ == "__main__":
    unittest.main()


class ArgonautSettingsTests(unittest.TestCase):
    setUp, tearDown, _wait = SupervisorTests.setUp, SupervisorTests.tearDown, SupervisorTests._wait

    def test_admin_server_settings_replace_the_environment_and_restart_workers(self):
        self.api.machines = [machine("m1")]
        self.supervisor.discover_once()
        self._wait(lambda: len(self.built) == 1)
        self.assertIsNone(self.built[0].spec.argonaut)
        self.assertEqual(self.supervisor.status()["argonaut_settings"], "environment")

        self.api.argonaut = {"url": "https://argo:3003/api/mes/trigger-transaction", "location_id": "loc",
                             "username": "mes", "password": "secret", "transaction_type_id": 101, "verify_tls": False}
        self.supervisor.discover_once()
        self._wait(lambda: len(self.built) == 2)
        self.assertTrue(self.built[0].stopped.is_set())
        self.assertNotIn("secret", repr(self.built[1].spec))
        self.assertEqual(self.supervisor.status()["argonaut_settings"], "MeshForge Server Settings")

        # Unchanged settings leave the worker running; an unreadable API keeps the last ones.
        self.supervisor.discover_once()
        self.api.argonaut_error = OSError("API down")
        self.supervisor.discover_once()
        self.assertEqual(len(self.built), 2)
        self.assertEqual(self.built[1].spec.argonaut.username, "mes")

    def test_override_applies_over_the_environment_and_machine_url_still_wins(self):
        env = Settings(machine_ip="", scanner_ip="", argonaut_url="https://env/x", argonaut_location_id="env-loc",
                       argonaut_username="user", argonaut_password="pw")
        o = ArgonautOverride.from_api({"url": "", "location_id": "admin-loc", "username": "mes", "password": "p",
                                       "transaction_type_id": 101, "verify_tls": False})
        s = o.apply(env)
        self.assertEqual((s.argonaut_url, s.argonaut_location_id, s.argonaut_username, s.argonaut_password,
                          s.argonaut_transaction_type_id, s.argonaut_verify_tls),
                         ("https://env/x", "admin-loc", "mes", "p", 101, False))
        machine_specific = with_machine_argonaut(s, "https://machine/x", "")
        self.assertEqual((machine_specific.argonaut_url, machine_specific.argonaut_location_id),
                         ("https://machine/x", "admin-loc"))
        self.assertIsNone(ArgonautOverride.from_api(None))

    def test_without_the_password_the_environment_sign_in_is_kept(self):
        # An administrator sign-in is never sent the Argonaut password, only whether one is set.
        env = Settings(machine_ip="", scanner_ip="", argonaut_url="https://env/x", argonaut_location_id="env-loc",
                       argonaut_username="user", argonaut_password="pw")
        o = ArgonautOverride.from_api({"url": "https://admin/x", "location_id": "", "username": "mes",
                                       "password_set": True, "transaction_type_id": 101, "verify_tls": True})
        s = o.apply(env)
        self.assertEqual((s.argonaut_url, s.argonaut_username, s.argonaut_password, s.argonaut_transaction_type_id),
                         ("https://admin/x", "user", "pw", 101))


class MacroReadTests(unittest.TestCase):
    setUp, tearDown, _wait = SupervisorTests.setUp, SupervisorTests.tearDown, SupervisorTests._wait

    def test_cycle_test_lab_reads_need_the_collector_token_and_a_running_worker(self):
        self.api.machines = [machine("m1")]
        self.supervisor.discover_once()
        self._wait(lambda: self.supervisor._slots["m1"].worker is not None)
        read = self.supervisor.read_macros
        self.assertEqual(read("m1", "numbers=10020", "")[0], 401)
        self.assertEqual(read("m1", "numbers=10020", "Bearer glr_wrong")[0], 401)
        self.assertEqual(read("m1", "numbers=abc", "Bearer glr_good")[0], 400)
        self.assertEqual(read("m1", "numbers=", "Bearer glr_good")[0], 400)
        self.assertEqual(read("nope", "numbers=10020", "Bearer glr_good")[0], 404)
        code, body = read("m1", "numbers=10020,10039", "Bearer glr_good")
        self.assertEqual(code, 200)
        self.assertEqual(body["values"], {"10020": "373", "10039": None})
        self.supervisor._slots["m1"].worker.fail = True
        self.assertEqual(read("m1", "numbers=10020", "Bearer glr_good")[0], 503)


    def test_scanner_commands_need_the_collector_token_and_go_to_the_worker_holding_the_scanner(self):
        self.api.machines = [machine("m1", scanner_ip="10.16.80.57")]
        self.supervisor.discover_once()
        self._wait(lambda: self.supervisor._slots["m1"].worker is not None)
        send = self.supervisor.scanner_command
        good = "Bearer glr_good"
        self.assertEqual(send("10.16.80.57", b'{"command": "TUNE01"}', "")[0], 401)
        self.assertEqual(send("10.16.80.57", b'{"command": "TUNE01"}', "Bearer glr_wrong")[0], 401)
        self.assertEqual(send("10.16.80.57", b'{"command": "tune\\r"}', good)[0], 400)
        self.assertEqual(send("10.16.80.57", b"not json", good)[0], 400)
        self.assertEqual(send("10.16.80.99", b'{"command": "TUNE01"}', good)[0], 404)
        self.assertEqual(send("", b'{"command": "TUNE01"}', good)[0], 404)
        code, body = send("10.16.80.57", b'{"command": "TUNE01"}', good)
        self.assertEqual((code, body["reply"]), (200, "OK,TUNE01"))
        self.supervisor._slots["m1"].worker.fail = True
        self.assertEqual(send("10.16.80.57", b'{"command": "TUNE01"}', good)[0], 502)

    def test_only_this_collectors_own_token_is_accepted(self):
        import os
        from lapper_read.api import MeshForgeApi
        pasted = MeshForgeApi("http://api", "", "", token="glr_pasted")
        self.assertTrue(pasted.is_collector_token("glr_pasted"))
        self.assertFalse(pasted.is_collector_token("glr_other"))
        self.assertFalse(pasted.is_collector_token(""))
        path = os.path.join(self.dir.name, "token")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("glr_file\n")
        from_file = MeshForgeApi("http://api", "", "", token_file=path)
        self.assertTrue(from_file.is_collector_token("glr_file"))
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("glr_reconnected")  # an admin reconnected the collector: the new token is read
        self.assertTrue(from_file.is_collector_token("glr_reconnected"))
        self.assertFalse(from_file.is_collector_token("glr_file"))
        self.assertFalse(MeshForgeApi("http://api", "a@b", "pw").is_collector_token("glr_file"))
