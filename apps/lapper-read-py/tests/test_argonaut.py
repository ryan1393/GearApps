import base64
import json
import os
import tempfile
import threading
import time
import unittest
from dataclasses import replace
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from lapper_read import argonaut as argo
from lapper_read.config import ConfigError, Settings, from_env
from lapper_read.fanuc import Fanuc
from lapper_read.state import ArgonautPost, CycleState, CycleStateStore, ScannerState
from lapper_read.worker import Worker
from tests.fakes import FakeApi, FakeTransport


class FakeArgonaut:
    def __init__(self):
        self.posts: list[dict] = []
        self.fail: list[argo.ArgonautError] = []

    def post(self, payload):
        if self.fail:
            raise self.fail.pop(0)
        self.posts.append(payload)


class PayloadTests(unittest.TestCase):
    def test_payload_matches_the_original_collector(self):
        values = {str(n): "1.5" for n in argo.FLOAT_MACROS}
        values.update({"10020": "373", "10021": "12", "10023": "7.0", "10400": "4", "10480": None})
        values["10063"] = None
        body = argo.build_payload("DM2A4C80ZS", 373, 42, values)["request"]
        self.assertEqual(body["sequence"], 42)
        self.assertEqual(body["transactionTypeId"], 100)
        self.assertEqual(body["serialNumber"], "DM2A4C80ZS")
        self.assertEqual(body["partNumber"], "373")
        self.assertEqual(body["partNumberCode"], 0)
        self.assertEqual(body["dintData"], [])
        self.assertEqual(len(body["floatData"]), 1 + len(argo.FLOAT_MACROS))
        self.assertEqual(body["floatData"][0], 0)
        self.assertEqual(body["floatData"][1], 1.5)
        self.assertEqual(body["floatData"][1 + argo.FLOAT_MACROS.index(10063)], 0)  # missing -> 0
        self.assertEqual(body["stringData"], ["373", "12", "7", "4", "0"])
        json.dumps(body)  # serializable

    def test_cycle_time_is_sent_as_float_zero(self):
        body = argo.build_payload("SN-1", 373, 1, {}, cycle_time_s=184.25)["request"]
        self.assertEqual(body["floatData"][0], 184.25)
        self.assertEqual(argo.build_payload("SN-1", 373, 1, {}, cycle_time_s=90.0)["request"]["floatData"][0], 90)
        self.assertEqual(argo.build_payload("SN-1", 373, 1, {}, cycle_time_s=12.34567)["request"]["floatData"][0], 12.346)
        for unknown in (None, -1.0, float("nan")):
            self.assertEqual(argo.build_payload("SN-1", 373, 1, {}, cycle_time_s=unknown)["request"]["floatData"][0], 0)

    def test_macro_lists_match_the_original_order(self):
        self.assertEqual(len(argo.FLOAT_MACROS), 63)
        self.assertEqual(argo.FLOAT_MACROS[:3], (10039, 10040, 10042))
        self.assertEqual(argo.FLOAT_MACROS[-1], 10517)
        self.assertEqual(len(set(argo.MACROS)), len(argo.MACROS))


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.received, self.status = [], 200
        test = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):  # noqa: N802
                body = self.rfile.read(int(self.headers["Content-Length"]))
                test.received.append((self.path, dict(self.headers), json.loads(body)))
                self.send_response(test.status)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_port}/api/mes/trigger-transaction"

    def tearDown(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()

    def test_posts_json_with_location_and_basic_auth(self):
        client = argo.ArgonautClient(self.url, "loc-1", "user", "pw", timeout_s=2)
        client.post({"request": {"sequence": 1}})
        path, headers, body = self.received[0]
        self.assertEqual(path, "/api/mes/trigger-transaction?locationId=loc-1")
        self.assertEqual(headers["Authorization"], "Basic " + base64.b64encode(b"user:pw").decode())
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(body, {"request": {"sequence": 1}})

    def test_a_pasted_url_keeps_its_own_location(self):
        client = argo.ArgonautClient(self.url + "?locationId=pasted", "default-loc", timeout_s=2)
        self.assertTrue(client.url.endswith("?locationId=pasted"))
        client.post({})
        self.assertEqual(self.received[0][0], "/api/mes/trigger-transaction?locationId=pasted")

    def test_http_errors_are_classified(self):
        client = argo.ArgonautClient(self.url, timeout_s=2)
        self.status = 400
        with self.assertRaises(argo.ArgonautError) as rejected:
            client.post({})
        self.assertTrue(rejected.exception.permanent)
        self.status = 503
        with self.assertRaises(argo.ArgonautError) as outage:
            client.post({})
        self.assertFalse(outage.exception.permanent)
        self.assertNotIn("Authorization", self.received[0][1])

    def test_unreachable_is_retryable(self):
        self.server.shutdown()
        self.server.server_close()
        self.server = None
        with self.assertRaises(argo.ArgonautError) as error:
            argo.ArgonautClient(self.url, timeout_s=1).post({})
        self.assertFalse(error.exception.permanent)
        self.server = None


class ConfigTests(unittest.TestCase):
    base = {"MESHFORGE_API_TOKEN": "glr_x"}

    def test_off_by_default(self):
        self.assertFalse(from_env(self.base, mode="supervise").argonaut_enabled)

    def test_enabled_needs_a_url(self):
        with self.assertRaises(ConfigError):
            from_env({**self.base, "ARGONAUT_ENABLED": "true"}, mode="supervise")
        settings = from_env({**self.base, "ARGONAUT_ENABLED": "yes", "ARGONAUT_URL": "https://10.0.0.9:3003/x",
                             "ARGONAUT_VERIFY_TLS": "false", "ARGONAUT_LOCATION_ID": "loc"}, mode="supervise")
        self.assertTrue(settings.argonaut_enabled)
        self.assertFalse(settings.argonaut_verify_tls)
        self.assertEqual(settings.argonaut_transaction_type_id, 100)

    def test_signs_in_like_the_original_collector_unless_configured(self):
        settings = from_env(self.base, mode="supervise")
        self.assertEqual((settings.argonaut_username, settings.argonaut_password), ("user", "pw"))
        client = argo.ArgonautClient("http://argo/x", username=settings.argonaut_username,
                                     password=settings.argonaut_password)
        self.assertEqual(client._auth, "Basic dXNlcjpwdw==")
        mine = from_env({**self.base, "ARGONAUT_USERNAME": " mes ", "ARGONAUT_PASSWORD": "secret"}, mode="supervise")
        self.assertEqual((mine.argonaut_username, mine.argonaut_password), ("mes", "secret"))

    def test_bad_boolean_is_rejected(self):
        with self.assertRaises(ConfigError):
            from_env({**self.base, "ARGONAUT_ENABLED": "maybe"}, mode="supervise")


class CheckpointTests(unittest.TestCase):
    def test_queue_survives_a_restart_and_old_checkpoints_still_load(self):
        with tempfile.TemporaryDirectory() as folder:
            store = CycleStateStore(os.path.join(folder, "m.json"))
            state = CycleState(argonaut_pending=[ArgonautPost("c1", "SN1", 373, 4, "2026-01-01T00:00:00+00:00",
                                                               {"10039": "1.5", "10040": None}, 2)])
            store.save(state)
            self.assertEqual(store.load().argonaut_pending, state.argonaut_pending)
            with open(store.path, "w", encoding="utf-8") as handle:
                json.dump({"pending_cycles": []}, handle)  # written before Argonaut support
            self.assertEqual(store.load().argonaut_pending, [])


class WorkerArgonautTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.settings = Settings(machine_ip="10.0.0.1", scanner_ip="10.0.0.2", state_dir=self.dir.name,
                                 poll_interval_ms=10, retry_delay_ms=20, api_email="a", api_password="b",
                                 argonaut_enabled=True, argonaut_url="http://argonaut.invalid/x")
        self.transport, self.api, self.argonaut = FakeTransport(), FakeApi(), FakeArgonaut()
        for number in argo.MACROS:
            self.transport.macros.setdefault(number, Decimal("2.25"))
        self.scanner = _Scanner()
        self.worker = self._worker()

    def tearDown(self):
        self.worker.stop()
        self.dir.cleanup()

    def _worker(self, settings=None):
        settings = settings or self.settings
        fanuc = Fanuc(self.transport, "10.0.0.1", 1000, self.api)
        return Worker(settings, self.api, fanuc, self.scanner, CycleStateStore(settings.state_file),
                      argonaut=self.argonaut if settings.argonaut_enabled else None)

    def _cycle(self, serial, consec):
        self.transport.macros[10032] = Decimal(consec)
        self.scanner.state = ScannerState(None, serial)
        time.sleep(0.2)
        self.transport.set_state(door=True, start=True, cycle=True)
        time.sleep(0.2)
        self.scanner.state = ScannerState(None, None)
        self.transport.set_state(door=False, start=False, cycle=False)

    def _run(self, worker, until):
        thread = threading.Thread(target=worker.run, daemon=True)
        thread.start()
        try:
            yield
            end = time.monotonic() + 10
            while not until():
                if time.monotonic() > end:
                    self.fail("condition not reached")
                time.sleep(0.01)
        finally:
            worker.stop()
            thread.join(3)

    def test_completed_cycle_is_sent_to_argonaut_and_meshforge(self):
        for _ in self._run(self.worker, lambda: self.argonaut.posts and self.api.macro_logs):
            self._cycle("DM2A4C80ZS", 7)
        body = self.argonaut.posts[0]["request"]
        self.assertEqual((body["serialNumber"], body["sequence"], body["partNumber"]), ("DM2A4C80ZS", 7, "373"))
        self.assertEqual(body["floatData"][1], 2.25)
        # The cycle ran for about 0.2s between going into and out of cycle.
        self.assertGreater(body["floatData"][0], 0.1)
        self.assertLess(body["floatData"][0], 5)
        self.assertEqual(body["stringData"][0], "373")
        self.assertEqual(self.worker.status()["argonaut"], "on")
        self.assertEqual(self.worker.status()["argonaut_pending"], 0)

    def test_argonaut_outage_does_not_hold_up_meshforge_and_is_retried(self):
        self.argonaut.fail = [argo.ArgonautError("down"), argo.ArgonautError("down", 503)]
        for _ in self._run(self.worker, lambda: self.argonaut.posts):
            self._cycle("SN-1", 3)
        self.assertTrue(self.api.macro_logs)
        self.assertEqual(len(self.argonaut.posts), 1)

    def test_rejected_post_is_dropped_and_cycle_without_serial_is_skipped(self):
        self.argonaut.fail = [argo.ArgonautError("bad", 400)]
        for _ in self._run(self.worker, lambda: self.worker.status()["argonaut_pending"] == 0
                           and len([c for c in self.api.calls if c[0] == "cycle"]) == 2):
            self._cycle("SN-1", 3)
            self._cycle(None, 4)
        self.assertEqual(self.argonaut.posts, [])

    def test_disabled_reads_no_argonaut_macros(self):
        settings = replace(self.settings, argonaut_enabled=False)
        worker = self.worker = self._worker(settings)
        reads = []
        original = self.transport.read_macro
        self.transport.read_macro = lambda handle, number: (reads.append(number), original(handle, number))[1]
        for _ in self._run(worker, lambda: self.api.macro_logs):
            self._cycle("SN-1", 3)
        self.assertNotIn(10039, reads)
        self.assertEqual(worker.status()["argonaut"], "off")
        self.assertEqual(self.argonaut.posts, [])


class _Scanner:
    def __init__(self):
        self.state = ScannerState(None, None)

    def read(self, previous):
        return self.state

    def close(self):
        pass


if __name__ == "__main__":
    unittest.main()


class PerMachineUrlTests(unittest.TestCase):
    def test_admin_url_turns_argonaut_on_for_that_machine_only(self):
        from lapper_read.supervisor import desired_machines, with_machine_argonaut

        machines = [
            {"id": "m1", "number": "A", "ip": "10.0.0.1", "status": "Active",
             "argonaut_url": " https://argo-1:3003/api/mes/trigger-transaction ", "argonaut_location_id": "loc-1"},
            {"id": "m2", "number": "B", "ip": "10.0.0.2", "status": "Active", "argonaut_url": None},
        ]
        wanted, _ = desired_machines(machines, [])
        self.assertEqual(wanted["m1"].argonaut_url, "https://argo-1:3003/api/mes/trigger-transaction")
        self.assertEqual(wanted["m2"].argonaut_url, "")
        base = Settings(machine_ip="", scanner_ip="", argonaut_location_id="default-loc", argonaut_username="u")
        one = with_machine_argonaut(base, wanted["m1"].argonaut_url, wanted["m1"].argonaut_location_id)
        self.assertTrue(one.argonaut_enabled)
        self.assertEqual((one.argonaut_url, one.argonaut_location_id, one.argonaut_username),
                         ("https://argo-1:3003/api/mes/trigger-transaction", "loc-1", "u"))
        self.assertIs(with_machine_argonaut(base, "", ""), base)  # collector default (off here)
        self.assertEqual(with_machine_argonaut(base, "http://x", "").argonaut_location_id, "default-loc")

    def test_changing_the_url_in_admin_restarts_that_worker(self):
        from lapper_read.supervisor import desired_machines

        m = {"id": "m1", "number": "A", "ip": "10.0.0.1", "status": "Active", "argonaut_url": "http://a"}
        before, _ = desired_machines([m], [])
        after, _ = desired_machines([{**m, "argonaut_url": "http://b"}], [])
        self.assertNotEqual(before["m1"], after["m1"])

    def test_a_malformed_url_is_retried_not_raised(self):
        with self.assertRaises(argo.ArgonautError) as error:
            argo.ArgonautClient("notaurl").post({})
        self.assertFalse(error.exception.permanent)
