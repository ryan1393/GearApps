"""Scanner reachability: an ICMP ping plus a TCP check of the scanner's command port.

A worker reads its scanner on every poll only while the scanner is online. Once a read fails the
scanner is offline and this monitor checks it in the background (ping, then a connect to its port)
every `check_interval_s`, so an unplugged scanner never stalls the machine polling. When the port
accepts a connection again the worker resumes reading serials.
"""

from __future__ import annotations

import os
import socket
import struct
import threading
import time
from collections.abc import Callable
from datetime import datetime, timezone


def ping(host: str, timeout_s: float = 1.0) -> bool | None:
    """True/False for an ICMP echo answer; None when this process may not send ICMP.

    Uses an unprivileged ICMP datagram socket (Docker allows these by default), so it needs neither
    root nor a `ping` binary.
    """
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_ICMP)
    except OSError:
        return None
    try:
        sock.settimeout(timeout_s)
        sequence = os.getpid() & 0xFFFF
        # Type 8 (echo request); the kernel sets the identifier and checksum of ping sockets.
        sock.sendto(struct.pack("!BBHHH", 8, 0, 0, 0, sequence) + b"lapper-read", (host, 0))
        deadline = time.monotonic() + timeout_s
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            sock.settimeout(remaining)
            packet, _address = sock.recvfrom(1024)
            if packet[:1] == b"\x00":  # echo reply
                return True
    except (socket.timeout, TimeoutError):
        return False
    except OSError:
        return False
    finally:
        sock.close()


def port_open(host: str, port: int, timeout_s: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_s):
            return True
    except OSError:
        return False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class ScannerMonitor:
    def __init__(self, host: str, port: int, timeout_s: float, check_interval_s: float = 30.0,
                 pinger: Callable[[str, float], bool | None] = ping,
                 port_check: Callable[[str, int, float], bool] = port_open):
        self.host, self.port, self.timeout_s, self.check_interval_s = host, port, timeout_s, check_interval_s
        self._ping, self._port_check = pinger, port_check
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.online = True  # optimistic until the first read says otherwise
        self.last_seen: str | None = None
        self.last_error: str | None = None
        self.ping_answers: bool | None = None
        self.last_check: str | None = None

    # -- called by the worker's sampling thread ------------------------------------------------
    def should_read(self) -> bool:
        return self.online

    def read_succeeded(self) -> bool:
        """Records a good read; True when the scanner just came back."""
        with self._lock:
            came_back = not self.online
            self.online, self.last_seen, self.last_error = True, _now(), None
            return came_back

    def read_failed(self, error: Exception) -> bool:
        """Marks the scanner offline (background checks take over); True when it just went offline."""
        with self._lock:
            went_offline = self.online
            self.online, self.last_error = False, str(error)
        # The first background check waits a full interval, so a scanner that accepts connections
        # but answers badly is retried every interval, not on every poll.
        return went_offline

    # -- background checks ---------------------------------------------------------------------
    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name=f"scanner-{self.host}", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

    def check_once(self) -> None:
        answers = self._ping(self.host, min(self.timeout_s, 2.0))
        reachable = self._port_check(self.host, self.port, self.timeout_s)
        with self._lock:
            self.ping_answers, self.last_check = answers, _now()
            if reachable:
                self.online, self.last_error = True, None  # the worker reads it again on its next poll
            elif not self.online:
                self.last_error = f"port {self.port} does not accept connections"

    def _run(self) -> None:
        while not self._stop.is_set():
            self._wake.wait(self.check_interval_s)
            self._wake.clear()
            if self._stop.is_set():
                break
            if not self.online:
                self.check_once()

    def status(self) -> dict:
        with self._lock:
            return {
                "scanner": "online" if self.online else "offline",
                "scanner_ping": {True: "answers", False: "no answer", None: "unknown"}[self.ping_answers],
                "scanner_last_seen": self.last_seen,
                "scanner_last_check": self.last_check,
                "scanner_error": self.last_error,
            }
