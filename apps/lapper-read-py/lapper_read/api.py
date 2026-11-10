"""GearApps API client: sign-in, token refresh and idempotent writes (stdlib only)."""

from __future__ import annotations

import json
import logging
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

log = logging.getLogger(__name__)


class ApiError(IOError):
    def __init__(self, method: str, path: str, status: int, body: str = ""):
        super().__init__(f"{method} {path} failed with HTTP {status} {body[:200]}".strip())
        self.status = status


def _number(value: Decimal) -> int | float:
    """JSON number for a macro value, keeping whole numbers whole."""
    return int(value) if value == value.to_integral_value() else float(value)


class GearAppsApi:
    def __init__(self, base_url: str, email: str, password: str, timeout_s: float = 10.0):
        self.base_url = base_url.rstrip("/")
        self._email, self._password, self._timeout = email, password, timeout_s
        self._token: str | None = None
        self._auth_lock = threading.Lock()

    # -- transport -------------------------------------------------------
    def _raw(self, method: str, path: str, body: Any = None, token: str | None = None,
             idempotency_key: str | None = None) -> tuple[int, Any]:
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(self.base_url + path, data=data, method=method)
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        if token:
            request.add_header("Authorization", "Bearer " + token)
        if idempotency_key:
            request.add_header("Idempotency-Key", idempotency_key)
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read()
                return response.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as error:
            text = error.read().decode("utf-8", errors="replace")
            return error.code, text

    def _login(self) -> str:
        status, body = self._raw("POST", "/api/v1/auth/email/login", {"email": self._email, "password": self._password})
        if status != 200 or not isinstance(body, dict) or not body.get("accessToken"):
            raise ApiError("POST", "/api/v1/auth/email/login", status)
        self._token = body["accessToken"]
        return self._token

    def _access_token(self) -> str:
        with self._auth_lock:
            return self._token or self._login()

    def request(self, method: str, path: str, body: Any = None, idempotency_key: str | None = None,
                allow_404: bool = False) -> Any:
        used = self._access_token()
        status, payload = self._raw(method, path, body, used, idempotency_key)
        if status == 401:
            # Refresh once; never overwrite a newer token another thread already obtained.
            with self._auth_lock:
                if self._token in (None, used):
                    self._login()
                used = self._token
            status, payload = self._raw(method, path, body, used, idempotency_key)
        if allow_404 and status == 404:
            return None
        if not 200 <= status < 300:
            raise ApiError(method, path, status, payload if isinstance(payload, str) else "")
        return payload

    # -- endpoints (the same ones the C# worker uses) ---------------------
    def machine_by_ip(self, ip: str, number: str | None) -> dict:
        path = "/api/v1/machine/ip/" + urllib.parse.quote(ip, safe="")
        if number:
            path += "?number=" + urllib.parse.quote(number, safe="")
        return self._required(self.request("GET", path), "machine")

    def scanner_by_ip(self, ip: str) -> dict:
        return self._required(self.request("GET", "/api/v1/scanner-detail/ip/" + urllib.parse.quote(ip, safe="")), "scanner")

    def fanuc_variables(self, machine_id: str) -> dict:
        found = self.request("GET", "/api/v1/machine-fanuc-variable/by-machine/" + machine_id, allow_404=True)
        if found is None:
            found = self.request("POST", "/api/v1/machine-fanuc-variable", {
                "machine_id": machine_id, "x06_7_frt_dr_closed": False,
                "x01_2_start_cycle": False, "y03_2_stack_inCycle": False,
            })
        return self._required(found, "machine I/O snapshot")

    def macros(self) -> list[dict]:
        found = self.request("GET", "/api/v1/macro")
        if not isinstance(found, list):
            raise ApiError("GET", "/api/v1/macro", 200, "unexpected body")
        return found

    def gearset_by_number(self, part_number: int) -> dict:
        found = self.request("GET", f"/api/v1/gearset/number/{part_number}", allow_404=True)
        if found is None:
            # Unknown gearsets are created as pending records an admin completes in GearApps.
            found = self.request("POST", "/api/v1/gearset", {
                "number": str(part_number), "status": "active", "summary_id": None,
                "pinion_id": None, "ring_id": None, "user_id": None,
            })
        return self._required(found, "gearset")

    def post_cycle(self, serial: str, consec: int, machine_id: str, gearset_id: str,
                   completed_at: str, key: str) -> dict:
        if not serial or not serial.strip():
            raise ValueError("A scanned serial number is required.")
        return self._required(self.request("POST", "/api/v1/machine-cycle", {
            "serial_number": serial, "machine_id": machine_id, "gearset_id": gearset_id,
            "consec": consec, "timestamp": completed_at,
        }, idempotency_key=key), "machine cycle")

    def post_macro_log(self, cycle_id: str, macro_id: str, value: Decimal, key: str) -> dict:
        return self._required(self.request("POST", "/api/v1/macro-log", {
            "machine_cycle_id": cycle_id, "macro_id": macro_id, "value": _number(value),
        }, idempotency_key=key), "macro log")

    def lapping_summary(self, machine_id: str, gearset_id: str) -> list[dict]:
        found = self.request("GET", f"/api/v1/macro-log/summary/{machine_id}/{gearset_id}")
        return found if isinstance(found, list) else []

    def patch_scanner_serials(self, scanner_id: str, process: str | None, queue: str | None,
                              scanner: str | None) -> dict:
        return self._required(self.request("PATCH", f"/api/v1/scanner-detail/{scanner_id}/serial-numbers", {
            "sn_procces": process, "sn_queue": queue, "sn_scanner": scanner,
        }), "scanner serial update")

    def patch_fanuc_variables(self, variables_id: str, door_closed: bool, start_cycle: bool, in_cycle: bool) -> dict:
        return self._required(self.request("PATCH", f"/api/v1/machine-fanuc-variable/{variables_id}", {
            "x06_7_frt_dr_closed": door_closed, "x01_2_start_cycle": start_cycle, "y03_2_stack_inCycle": in_cycle,
        }), "machine I/O update")

    @staticmethod
    def _required(payload: Any, what: str) -> dict:
        if not isinstance(payload, dict) or not payload.get("id"):
            raise ApiError("API", what, 200, "response has no id")
        return payload


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
