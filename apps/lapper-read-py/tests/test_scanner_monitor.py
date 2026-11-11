import socket
import threading
import unittest

from lapper_read.scanner_monitor import ScannerMonitor, port_open


class ScannerMonitorTests(unittest.TestCase):
    def test_a_failed_read_takes_the_scanner_offline_until_its_port_answers(self):
        port_answers = {"value": False}
        monitor = ScannerMonitor("10.0.0.9", 9004, 1, check_interval_s=60,
                                 pinger=lambda host, timeout: True,
                                 port_check=lambda host, port, timeout: port_answers["value"])
        self.assertTrue(monitor.should_read())
        self.assertTrue(monitor.read_failed(IOError("Connection refused")))
        self.assertFalse(monitor.read_failed(IOError("Connection refused")))  # reported once
        self.assertFalse(monitor.should_read())

        monitor.check_once()
        status = monitor.status()
        self.assertEqual((status["scanner"], status["scanner_ping"]), ("offline", "answers"))
        self.assertIn("port 9004", status["scanner_error"])

        port_answers["value"] = True
        monitor.check_once()
        self.assertTrue(monitor.should_read())
        self.assertTrue(monitor.read_succeeded() is False)  # already marked online by the check
        self.assertEqual(monitor.status()["scanner"], "online")
        self.assertIsNotNone(monitor.status()["scanner_last_seen"])

    def test_ping_without_permission_is_reported_as_unknown(self):
        monitor = ScannerMonitor("10.0.0.9", 9004, 1, pinger=lambda host, timeout: None,
                                 port_check=lambda host, port, timeout: False)
        monitor.read_failed(IOError("timed out"))
        monitor.check_once()
        self.assertEqual(monitor.status()["scanner_ping"], "unknown")

    def test_port_check_against_a_real_listener(self):
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen()
        port = server.getsockname()[1]
        accept = threading.Thread(target=lambda: server.accept()[0].close(), daemon=True)
        accept.start()
        try:
            self.assertTrue(port_open("127.0.0.1", port, 1))
            accept.join(1)
        finally:
            server.close()

    def test_port_check_against_a_closed_port(self):
        # Bound but not listening: the port stays reserved for this test, so
        # nothing else can take it, and every connect is refused.
        reserved = socket.socket()
        reserved.bind(("127.0.0.1", 0))
        try:
            self.assertFalse(port_open("127.0.0.1", reserved.getsockname()[1], 0.5))
        finally:
            reserved.close()
