"""Keyence-style scanner command protocol over TCP (input 1), as used by the C# worker."""

from __future__ import annotations

import re
import socket
import time
from typing import Callable

from .state import ScannerState

# Serial format in the existing scanner protocol: D followed by nine characters.
SERIAL_PATTERN = re.compile(r"(?<![A-Za-z0-9])D[A-Za-z0-9]{9}(?=[:\r\n]|$)")
MAX_FRAME = 8192
#: Op codes the dashboard may send (the API checks the same pattern).
COMMAND_PATTERN = re.compile(r"[A-Z0-9,_-]{1,32}")
#: Tuning and focusing can take several seconds before the scanner acknowledges them.
SLOW_COMMANDS = ("TUNE", "FTUNE")
SLOW_COMMAND_TIMEOUT_S = 10.0


def _is_error(frame: str) -> bool:
    return frame.startswith("ER")


def _is_reply(frame: str) -> bool:
    """A command's acknowledgement (OK…), a rejection (ER…/ERROR) or a read result (a serial)."""
    return frame.startswith("OK") or _is_error(frame) or SERIAL_PATTERN.search(frame) is not None


def _is_read_result(frame: str) -> bool:
    """The end of a read the dashboard triggered: the serial, or ERROR when nothing was read."""
    return _is_error(frame) or SERIAL_PATTERN.search(frame) is not None


class ScannerError(IOError):
    pass


def _is_aim_reply(frame: str) -> bool:
    return frame.startswith("OK,AM") or _is_error(frame)


class Channel:
    def __init__(self, host: str, port: int, timeout_s: float):
        self.host, self.port, self.timeout_s = host, port, timeout_s
        self._socket: socket.socket | None = None
        self._buffer = ""

    def close(self) -> None:
        if self._socket is not None:
            try:
                self._socket.close()
            finally:
                self._socket = None
        self._buffer = ""

    def exchange(self, command: str, wait_for_serial: bool = False,
                 expect: Callable[[str], bool] | None = None, timeout_s: float | None = None) -> str:
        """Sends `command` and returns its reply frame. Frames that `expect` rejects (a late reply to
        an earlier command, such as one the dashboard sent) are skipped, so replies stay in step."""
        deadline = time.monotonic() + (timeout_s or self.timeout_s)
        try:
            if self._socket is None:
                self._socket = socket.create_connection((self.host, self.port), timeout=self.timeout_s)
            self._socket.sendall((command.rstrip("\r\n") + "\r").encode("ascii"))
            while True:
                index = min((i for i in (self._buffer.find("\r"), self._buffer.find("\n")) if i >= 0), default=-1)
                if index >= 0:
                    frame = self._buffer[:index]
                    consumed = index + 1
                    # Consume CRLF as one delimiter while keeping any coalesced next frame.
                    if self._buffer[index] == "\r" and self._buffer[consumed : consumed + 1] == "\n":
                        consumed += 1
                    self._buffer = self._buffer[consumed:]
                    if not frame:
                        continue
                    if wait_for_serial:
                        if SERIAL_PATTERN.search(frame):
                            return frame
                        if frame.startswith("ER"):
                            raise ScannerError("Scanner rejected the scan command.")
                        continue  # LON acknowledgements may precede the barcode frame.
                    if expect is None or expect(frame):
                        return frame
                    continue  # not this command's reply
                if len(self._buffer) > MAX_FRAME:
                    raise ScannerError("Scanner response exceeded the maximum frame length.")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Scanner did not answer in time.")
                self._socket.settimeout(remaining)
                chunk = self._socket.recv(512)
                if not chunk:
                    raise ScannerError("Scanner disconnected while receiving a response.")
                self._buffer += chunk.decode("ascii", errors="replace")
        except BaseException:
            self.close()  # reconnect on the next poll
            raise


class Scanner:
    def __init__(self, host: str, input1_port: int, timeout_s: float):
        self._input1 = Channel(host, input1_port, timeout_s)

    def close(self) -> None:
        self._input1.close()

    def command(self, op: str) -> str:
        """Sends a dashboard op code (Tune, Focus, outputs, trigger, test) on the connection the
        worker already holds, since the scanner accepts only one, and returns the scanner's reply.
        A trigger (LON…) waits for its read result so a late serial cannot reach the next poll."""
        if not COMMAND_PATTERN.fullmatch(op):
            raise ValueError("command must be an upper-case scanner op code")
        slow = op.startswith(SLOW_COMMANDS)
        timeout_s = max(self._input1.timeout_s, SLOW_COMMAND_TIMEOUT_S) if slow else None
        expect = _is_read_result if op.startswith("LON") else _is_reply
        return self._input1.exchange(op, expect=expect, timeout_s=timeout_s)

    def read(self, previous: ScannerState) -> ScannerState:
        # A serial in place of the input state is still taken as a scan, as before.
        response = self._input1.exchange(
            "INCHK,1", expect=lambda f: "INCHK" in f or _is_error(f) or SERIAL_PATTERN.search(f) is not None)
        if "OK,INCHK,OFF" in response:
            if previous.serial is not None and previous.queue is None:
                return ScannerState(None, previous.serial)
            self._input1.exchange("AMON", expect=_is_aim_reply)
            return previous
        if "OK,INCHK,ON" in response:
            if previous.serial is not None:
                self._input1.exchange("AMOFF", expect=_is_aim_reply)
                return previous
            self._input1.exchange("AMON", expect=_is_aim_reply)
            response = self._input1.exchange("LON01", wait_for_serial=True)
        match = SERIAL_PATTERN.search(response)
        if not match:
            raise ScannerError("The scanner response did not contain a complete serial or input state.")
        serial = match.group(0)
        return ScannerState(serial, None if previous.queue == serial else previous.queue)
