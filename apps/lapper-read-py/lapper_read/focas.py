"""ctypes binding to FANUC's FOCAS library (libfwlib32.so on Linux, FWLIB32.dll on Windows).

Only the four calls Lapper needs are bound: connect, read a P-code macro, read a PMC
byte and disconnect. Structures use C `long`, exactly like fwlib32.h, so the same code
matches the 4-byte Windows build and the 8-byte 64-bit Linux build.
"""

from __future__ import annotations

import ctypes
import os
import threading
from ctypes import POINTER, Structure, Union, byref, c_char, c_char_p, c_double, c_float, c_long, c_short, c_ushort
from decimal import Decimal

EW_OK = 0
PMC_Y = 2
PMC_X = 3
PMC_BYTE = 0


class FocasError(IOError):
    def __init__(self, operation: str, code: int):
        super().__init__(f"FANUC {operation} failed (code {code}).")
        self.code = code


class ODBPM(Structure):
    """cnc_rdpmacro: read P-code macro variable."""

    _fields_ = [("datano", c_long), ("dummy", c_short), ("mcr_val", c_long), ("dec_val", c_short)]


class _PmcData(Union):
    _fields_ = [
        ("cdata", c_char * 5),
        ("idata", c_short * 5),
        ("ldata", c_long * 5),
        ("fdata", c_float * 5),
        ("dfdata", c_double * 5),
    ]


class IODBPMC(Structure):
    """pmc_rdpmcrng: read a PMC address range."""

    _fields_ = [
        ("type_a", c_short),
        ("type_d", c_short),
        ("datano_s", c_ushort),
        ("datano_e", c_ushort),
        ("u", _PmcData),
    ]


def scale(mcr_val: int, dec_val: int) -> Decimal:
    """mcr_val with dec_val decimal places (a negative dec_val multiplies), as in the C# worker."""
    return Decimal(mcr_val).scaleb(-dec_val)


class FocasLibrary:
    """Loads the vendor library once per process and runs Linux process start-up."""

    _lock = threading.Lock()
    _instance: "FocasLibrary | None" = None

    def __init__(self, path: str, log_path: str):
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"FOCAS library not found at {path}. Mount FANUC's licensed libfwlib32.so "
                "(Linux) into the container and set FOCAS_LIBRARY."
            )
        loader = ctypes.WinDLL if os.name == "nt" else ctypes.CDLL  # type: ignore[attr-defined]
        self.lib = loader(path)
        lib = self.lib
        lib.cnc_allclibhndl3.argtypes = [c_char_p, c_ushort, c_long, POINTER(c_ushort)]
        lib.cnc_allclibhndl3.restype = c_short
        lib.cnc_freelibhndl.argtypes = [c_ushort]
        lib.cnc_freelibhndl.restype = c_short
        lib.cnc_rdpmacro.argtypes = [c_ushort, c_long, POINTER(ODBPM)]
        lib.cnc_rdpmacro.restype = c_short
        lib.pmc_rdpmcrng.argtypes = [c_ushort, c_short, c_short, c_ushort, c_ushort, c_ushort, POINTER(IODBPMC)]
        lib.pmc_rdpmcrng.restype = c_short
        if hasattr(lib, "cnc_exitthread"):
            lib.cnc_exitthread.argtypes = []
            lib.cnc_exitthread.restype = c_short
        if os.name != "nt" and hasattr(lib, "cnc_startupprocess"):
            # The Linux library must be started once per process before any handle is opened.
            lib.cnc_startupprocess.argtypes = [c_long, c_char_p]
            lib.cnc_startupprocess.restype = c_short
            os.makedirs(os.path.dirname(log_path) or ".", exist_ok=True)
            code = lib.cnc_startupprocess(0, log_path.encode())
            if code != EW_OK:
                raise FocasError("library start-up", code)

    @classmethod
    def load(cls, path: str, log_path: str) -> "FocasLibrary":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(path, log_path)
            return cls._instance


class FocasTransport:
    """One transport per machine. Its handle is opened and used only on that machine's
    worker thread (like the C# worker's dedicated FOCAS thread); calls are also serialised."""

    def __init__(self, library_path: str, log_path: str, port: int = 8193):
        self._library_path, self._log_path, self._port = library_path, log_path, port
        self._lock = threading.Lock()

    @property
    def _lib(self):
        return FocasLibrary.load(self._library_path, self._log_path).lib

    def open(self, ip: str, timeout_s: int) -> int:
        with self._lock:
            handle = c_ushort()
            code = self._lib.cnc_allclibhndl3(ip.encode(), self._port, timeout_s, byref(handle))
            if code != EW_OK:
                raise FocasError(f"connect to {ip}:{self._port}", code)
            return handle.value

    def close(self, handle: int) -> None:
        with self._lock:
            self._lib.cnc_freelibhndl(handle)

    def read_macro(self, handle: int, number: int) -> Decimal | None:
        with self._lock:
            data = ODBPM()
            code = self._lib.cnc_rdpmacro(handle, number, byref(data))
        if code < 0:
            raise FocasError(f"read macro #{number}", code)
        if code != EW_OK:
            return None  # e.g. EW_NUMBER/EW_ATTRIB: variable not readable on this control
        return scale(data.mcr_val, data.dec_val)

    def exit_thread(self) -> None:
        """Releases the calling thread's FOCAS resources (Linux); call when a worker thread ends."""
        instance = FocasLibrary._instance
        if instance is not None and os.name != "nt" and hasattr(instance.lib, "cnc_exitthread"):
            instance.lib.cnc_exitthread()

    def read_pmc_bit(self, handle: int, address_type: int, byte: int, bit: int) -> bool:
        with self._lock:
            data = IODBPMC()
            length = 8 + 1  # header + one byte
            code = self._lib.pmc_rdpmcrng(handle, address_type, PMC_BYTE, byte, byte, length, byref(data))
        if code != EW_OK:
            raise FocasError("read PMC", code)
        return bool(data.u.cdata[0][0] >> bit & 1)
