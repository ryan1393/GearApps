import json
import os
import socket
import tempfile
import threading
import time
import unittest
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from lapper_read.api import ApiError, MeshForgeApi
from lapper_read.config import ConfigError, from_env
from lapper_read.scanner import Scanner
from lapper_read.state import ScannerState


class ScriptedScanner(threading.Thread):
    """Loopback scanner that answers each command with scripted raw chunks."""

    def __init__(self, replies):
        super().__init__(daemon=True)
        self.replies, self.commands = replies, []
        self.server = socket.socket()
        self.server.bind(("127.0.0.1", 0))
        self.server.listen()
        self.port = self.server.getsockname()[1]

    def run(self):
        with self.server:
            conn, _ = self.server.accept()
        with conn:
            buffer = b""
            for reply in self.replies:
                while b"\r" not in buffer:
                    data = conn.recv(64)
                    if not data:
                        return
                    buffer += data
                command, buffer = buffer.split(b"\r", 1)
                self.commands.append(command.decode())
                for chunk in reply:
                    conn.sendall(chunk)
            time.sleep(1)  # hold the connection open, like a scanner that stops answering


class ScannerTests(unittest.TestCase):
    def test_fragmented_and_coalesced_frames_produce_a_complete_serial(self):
        fake = ScriptedScanner([
            [b"OK,INCHK,O", b"N\r\n"],
            [b"OK,AMON\r"],
            [b"OK,LON\r\nD12345", b"6789\r\n"],
        ])
        fake.start()
        scanner = Scanner("127.0.0.1", fake.port, 2)
        state = scanner.read(ScannerState(None, None))
        scanner.close()
        self.assertEqual(state, ScannerState("D123456789", None))
        self.assertEqual(fake.commands, ["INCHK,1", "AMON", "LON01"])

    def test_input_1_triggers_once_and_queues_the_serial_on_release(self):
        serial = "D123456789"
        fake = ScriptedScanner([
            [b"OK,INCHK,OFF\r"], [b"OK,AMON\r"],
            [b"OK,INCHK,ON\r"], [b"OK,AMON\r"], [b"OK,LON01\r", f"{serial}\r".encode("ascii")],
            [b"OK,INCHK,ON\r"], [b"OK,AMOFF\r"],
            [b"OK,INCHK,OFF\r"],
        ])
        fake.start()
        scanner = Scanner("127.0.0.1", fake.port, 2)
        self.addCleanup(scanner.close)

        idle = scanner.read(ScannerState(None, None))
        scanned = scanner.read(idle)
        held = scanner.read(scanned)
        released = scanner.read(held)

        self.assertEqual(idle, ScannerState(None, None))
        self.assertEqual(scanned, ScannerState(serial, None))
        self.assertEqual(held, scanned)
        self.assertEqual(released, ScannerState(None, serial))
        self.assertEqual(fake.commands, [
            "INCHK,1", "AMON",
            "INCHK,1", "AMON", "LON01",
            "INCHK,1", "AMOFF",
            "INCHK,1",
        ])

    def test_dashboard_commands_share_the_polling_connection_and_replies_stay_in_step(self):
        serial = "DM1A48B0B7"
        fake = ScriptedScanner([
            [b"OK,TUNE\r"],
            # The trigger's acknowledgement comes before the read result (Keyence SR-1000 format).
            [b"OK,LON\r", f"{serial}:78:F/A/A:scanner-current.JPG\r".encode("ascii")],
            # A late acknowledgement from an earlier command is skipped, not taken as the input state.
            [b"OK,OUTON\r", b"OK,INCHK,OFF\r"],
            [b"OK,AMON\r"],
        ])
        fake.start()
        scanner = Scanner("127.0.0.1", fake.port, 2)
        self.addCleanup(scanner.close)

        self.assertEqual(scanner.command("TUNE01"), "OK,TUNE")
        self.assertEqual(scanner.command("LON01"), f"{serial}:78:F/A/A:scanner-current.JPG")
        self.assertEqual(scanner.read(ScannerState(None, None)), ScannerState(None, None))
        self.assertEqual(fake.commands, ["TUNE01", "LON01", "INCHK,1", "AMON"])

    def test_dashboard_command_rejections_and_bad_op_codes(self):
        fake = ScriptedScanner([[b"ER,FTUNE,02\r"]])
        fake.start()
        scanner = Scanner("127.0.0.1", fake.port, 2)
        self.addCleanup(scanner.close)
        with self.assertRaises(ValueError):
            scanner.command("LON\rRESET")
        self.assertEqual(scanner.command("FTUNE"), "ER,FTUNE,02")

    def test_timeout_drops_the_connection_so_the_next_poll_reconnects(self):
        fake = ScriptedScanner([[]])  # never answers
        fake.start()
        scanner = Scanner("127.0.0.1", fake.port, 0.3)
        with self.assertRaises(TimeoutError):
            scanner.read(ScannerState(None, None))
        self.assertIsNone(scanner._input1._socket)


class FakeServer(BaseHTTPRequestHandler):
    log = []
    tokens = iter([])
    revoked: set = set()
    #: Answers like an API from before cycle times: the unknown field fails validation.
    old_api = False

    def log_message(self, *args):
        pass

    def _reply(self, status, body=None):
        raw = json.dumps(body).encode() if body is not None else b""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length)) if length else None
        FakeServer.log.append((self.command, self.path, self.headers.get("Authorization"),
                               self.headers.get("Idempotency-Key"), body))
        if self.path.endswith("/auth/email/login"):
            return self._reply(200, {"accessToken": next(FakeServer.tokens)})
        if (self.headers.get("Authorization") or "").removeprefix("Bearer ") in FakeServer.revoked:
            return self._reply(401, {"message": "revoked"})
        if self.headers.get("Authorization") == "Bearer expired":
            return self._reply(401, {"message": "expired"})
        if self.path.startswith("/api/v1/gearset/number/404"):
            return self._reply(404, {"message": "missing"})
        if self.path.startswith("/api/v1/gearset/number/500"):
            return self._reply(500, {"message": "boom"})
        for field in ("cycle_time_s", "cycle_elapsed_s"):
            if FakeServer.old_api and field in (body or {}):
                # The real API's ValidationPipe answers 422 (errorHttpStatusCode in configure-api.ts).
                return self._reply(422, {"message": [f"property {field} should not exist"],
                                         "error": "Unprocessable Entity", "statusCode": 422})
            if (body or {}).get(field) == 999999:
                return self._reply(422, {"message": [f"{field} must not be greater than 86400"],
                                         "error": "Unprocessable Entity", "statusCode": 422})
        return self._reply(201 if self.command == "POST" else 200, {"id": "x1", **(body or {})})

    do_GET = do_POST = do_PATCH = _handle


class ApiTests(unittest.TestCase):
    def setUp(self):
        FakeServer.log = []
        FakeServer.revoked = set()
        FakeServer.old_api = False
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeServer)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.api = MeshForgeApi(f"http://127.0.0.1:{self.server.server_port}", "svc@plant", "secret", 3)

    def tearDown(self):
        self.server.shutdown()

    def test_unauthorized_write_refreshes_and_retries_with_the_same_key_and_payload(self):
        FakeServer.tokens = iter(["expired", "fresh"])
        self.api.post_cycle("D123456789", 4, "m1", "g1", "2026-11-10T03:00:00Z", "key-1")
        writes = [entry for entry in FakeServer.log if entry[1] == "/api/v1/machine-cycle"]
        self.assertEqual([w[2] for w in writes], ["Bearer expired", "Bearer fresh"])
        self.assertEqual({w[3] for w in writes}, {"key-1"})
        self.assertEqual(writes[0][4], writes[1][4])

    def test_only_not_found_creates_a_pending_gearset(self):
        FakeServer.tokens = iter(["t"])
        self.api.gearset_by_number(404)
        self.assertEqual(FakeServer.log[-1][:2], ("POST", "/api/v1/gearset"))
        self.assertEqual(FakeServer.log[-1][4]["number"], "404")
        with self.assertRaises(IOError):
            self.api.gearset_by_number(500)
        self.assertNotEqual(FakeServer.log[-1][:2], ("POST", "/api/v1/gearset"))

    def test_macro_values_are_json_numbers_and_keep_whole_numbers_whole(self):
        FakeServer.tokens = iter(["t"])
        self.api.post_macro_log("c1", "m1", Decimal("1800"), "k1")
        self.api.post_macro_log("c1", "m2", Decimal("0.125"), "k2")
        values = [entry[4]["value"] for entry in FakeServer.log if entry[1] == "/api/v1/macro-log"]
        self.assertEqual(values, [1800, 0.125])
        self.assertIsInstance(values[0], int)

    def test_collector_token_is_sent_without_signing_in(self):
        api = MeshForgeApi(f"http://127.0.0.1:{self.server.server_port}", "", "", 3, token="glr_abc")
        api.request("GET", "/api/v1/macro")
        self.assertEqual(FakeServer.log[-1][2], "Bearer glr_abc")
        self.assertFalse(any(e[1].endswith("/auth/email/login") for e in FakeServer.log))

    def test_token_file_is_used_and_reread_after_the_api_rejects_it(self):
        path = os.path.join(self.tmp.name, "token")
        api = MeshForgeApi(f"http://127.0.0.1:{self.server.server_port}", "", "", 3, token_file=path)
        with self.assertRaises(ApiError) as missing:
            api.request("GET", "/api/v1/macro")
        self.assertIn("Connect Docker collector", str(missing.exception))
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("glr_first\n")
        api.request("GET", "/api/v1/macro")
        self.assertEqual(FakeServer.log[-1][2], "Bearer glr_first")
        # An admin reconnects: the API revokes the old token and writes a new one.
        FakeServer.revoked = {"glr_first"}
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("glr_second")
        api.request("GET", "/api/v1/macro")
        self.assertEqual([e[2] for e in FakeServer.log[-2:]], ["Bearer glr_first", "Bearer glr_second"])
        self.assertFalse(any(e[1].endswith("/auth/email/login") for e in FakeServer.log))

    def test_a_revoked_token_file_token_reports_how_to_reconnect(self):
        path = os.path.join(self.tmp.name, "token")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("glr_first")
        FakeServer.revoked = {"glr_first"}
        api = MeshForgeApi(f"http://127.0.0.1:{self.server.server_port}", "", "", 3, token_file=path)
        with self.assertRaises(ApiError) as error:
            api.request("GET", "/api/v1/macro")
        self.assertIn("Connect Docker collector", str(error.exception))

    def test_a_cycle_without_a_scanner_is_posted_with_a_null_serial(self):
        FakeServer.tokens = iter(["t"])
        for serial in (None, " "):
            self.api.post_cycle(serial, 1, "m", "g", "2026-11-10T03:00:00Z", "k")
            self.assertIsNone(FakeServer.log[-1][4]["serial_number"])
        self.api.post_cycle(" D000000001 ", 2, "m", "g", "2026-11-10T03:00:00Z", "k2")
        self.assertEqual(FakeServer.log[-1][4]["serial_number"], "D000000001")

    def test_a_cycle_is_posted_with_its_cycle_time_and_without_one_when_unknown(self):
        FakeServer.tokens = iter(["t"])
        self.api.post_cycle("SN-1", 1, "m", "g", "2026-11-10T03:00:00Z", "k1", 124.25)
        self.assertEqual(FakeServer.log[-1][4]["cycle_time_s"], 124.25)
        self.api.post_cycle("SN-2", 2, "m", "g", "2026-11-10T03:00:00Z", "k2", None)
        self.assertNotIn("cycle_time_s", FakeServer.log[-1][4])

    def test_an_api_without_cycle_times_gets_the_cycle_again_without_it_under_the_same_key(self):
        FakeServer.tokens = iter(["t"])
        FakeServer.old_api = True
        saved = self.api.post_cycle("SN-1", 1, "m", "g", "2026-11-10T03:00:00Z", "k1", 124.25)
        self.assertEqual(saved["id"], "x1")
        writes = [entry for entry in FakeServer.log if entry[1] == "/api/v1/machine-cycle"]
        self.assertEqual([w[3] for w in writes], ["k1", "k1"])
        self.assertIn("cycle_time_s", writes[0][4])
        self.assertNotIn("cycle_time_s", writes[1][4])
        self.assertEqual({k: v for k, v in writes[0][4].items() if k != "cycle_time_s"}, writes[1][4])

    def test_machine_io_carries_the_running_cycle_time_and_null_when_none(self):
        FakeServer.tokens = iter(["t"])
        self.api.patch_fanuc_variables("v1", True, False, True, 83.5)
        self.assertEqual(FakeServer.log[-1][4]["cycle_elapsed_s"], 83.5)
        self.api.patch_fanuc_variables("v1", False, False, False)
        self.assertIn("cycle_elapsed_s", FakeServer.log[-1][4])
        self.assertIsNone(FakeServer.log[-1][4]["cycle_elapsed_s"])

    def test_an_api_without_the_live_timer_gets_machine_io_without_it_from_then_on(self):
        FakeServer.tokens = iter(["t"])
        FakeServer.old_api = True
        self.api.patch_fanuc_variables("v1", True, False, True, 83.5)
        self.api.patch_fanuc_variables("v1", True, False, True, 84.5)
        writes = [e for e in FakeServer.log if e[1] == "/api/v1/machine-fanuc-variable/v1"]
        # Rejected once, then sent without the field; the next report leaves it out straight away.
        self.assertEqual(["cycle_elapsed_s" in w[4] for w in writes], [True, False, False])

    def test_a_value_out_of_range_is_an_error_not_a_missing_field(self):
        FakeServer.tokens = iter(["t"])
        with self.assertRaises(ApiError):
            self.api.patch_fanuc_variables("v1", True, False, True, 999999)
        with self.assertRaises(ApiError):
            self.api.post_cycle("SN-1", 1, "m", "g", "2026-11-10T03:00:00Z", "k9", 999999)
        # The fields are still sent afterwards: the API knows them.
        self.api.patch_fanuc_variables("v1", True, False, True, 10)
        self.assertEqual(FakeServer.log[-1][4]["cycle_elapsed_s"], 10)

    def test_machine_lookup_disambiguates_a_shared_ip_by_asset_number(self):
        FakeServer.tokens = iter(["t"])
        self.api.machine_by_ip("10.16.81.15", "01-094-101")
        self.assertEqual(FakeServer.log[-1][1], "/api/v1/machine/ip/10.16.81.15?number=01-094-101")


class ConfigTests(unittest.TestCase):
    BASE = {"LAPPER_MACHINE_IP": "10.16.81.15", "LAPPER_SCANNER_IP": "10.16.80.57",
            "MESHFORGE_API_EMAIL": "svc@plant", "MESHFORGE_API_PASSWORD": "x"}

    def test_valid_settings_and_defaults(self):
        s = from_env(self.BASE)
        self.assertEqual((s.focas_port, s.scanner_input1_port, s.poll_interval_ms), (8193, 9004, 250))
        self.assertTrue(s.state_file.endswith("/10.16.81.15.json"))

    def test_missing_credentials_or_bad_ip_fail_fast(self):
        with self.assertRaises(ConfigError):
            from_env({**self.BASE, "MESHFORGE_API_PASSWORD": ""})
        with self.assertRaises(ConfigError):
            from_env({**self.BASE, "LAPPER_MACHINE_IP": "lapper-1"})

    def test_a_collector_token_replaces_email_and_password(self):
        s = from_env({"MESHFORGE_API_TOKEN": "glr_abc"}, mode="supervise")
        self.assertEqual(s.api_token, "glr_abc")
        with self.assertRaises(ConfigError):
            from_env({"MESHFORGE_API_TOKEN": "eyJhbGciOi.jwt"}, mode="supervise")

    def test_supervise_only_needs_api_credentials(self):
        s = from_env({"MESHFORGE_API_EMAIL": "svc@plant", "MESHFORGE_API_PASSWORD": "x"}, mode="supervise")
        self.assertEqual(s.discover_interval_s, 30)

    def test_check_only_needs_the_controller_address(self):
        self.assertEqual(from_env({"LAPPER_MACHINE_IP": "10.16.81.15"}, mode="check").machine_ip, "10.16.81.15")


if __name__ == "__main__":
    unittest.main()
