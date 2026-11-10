"""Keyence-style scanner command protocol over TCP (input 1), as used by the C# worker."""

from __future__ import annotations

import re
import socket
import time

from .state import ScannerState

# Serial format in the existing scanner protocol: D followed by nine characters.
SERIAL_PATTERN = re.compile(r"(?<![A-Za-z0-9])D[A-Za-z0-9]{9}(?=[:\r\n]|$)")
MAX_FRAME = 8192


class ScannerError(IOError):
    pass


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

    def exchange(self, command: str, wait_for_serial: bool = False) -> str:
        deadline = time.monotonic() + self.timeout_s
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
                    if not wait_for_serial or SERIAL_PATTERN.search(frame):
                        return frame
                    if frame.startswith("ER"):
                        raise ScannerError("Scanner rejected the scan command.")
                    continue  # LON acknowledgements may precede the barcode frame.
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

    def read(self, previous: ScannerState) -> ScannerState:
        response = self._input1.exchange("INCHK,1")
        if "OK,INCHK,OFF" in response:
            if previous.serial is not None and previous.queue is None:
                return ScannerState(None, previous.serial)
            self._input1.exchange("AMON")
            return previous
        if "OK,INCHK,ON" in response:
            if previous.serial is not None:
                self._input1.exchange("AMOFF")
                return previous
            self._input1.exchange("AMON")
            response = self._input1.exchange("LON01", wait_for_serial=True)
        match = SERIAL_PATTERN.search(response)
        if not match:
            raise ScannerError("The scanner response did not contain a complete serial or input state.")
        serial = match.group(0)
        return ScannerState(serial, None if previous.queue == serial else previous.queue)
