"""Optional Argonaut (Track and Trace) post at the end of each lapping cycle.

Ported from the original C# Lapper Read (`Argonaut.ArgoPostMacroLog`): the same FANUC macros,
in the same order, are sent to Argonaut's `trigger-transaction` endpoint. It is off unless
`ARGONAUT_ENABLED` is set, and an Argonaut outage never holds up recording cycles in MeshForge.
"""

from __future__ import annotations

import base64
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal, InvalidOperation

from .api import is_permanent_rejection

#: floatData, in the order Argonaut expects. floatData[0], before these, is the cycle time in seconds.
FLOAT_MACROS: tuple[int, ...] = (
    10039, 10040, 10042, 10043, 10045, 10046, 10047, 10049, 10050, 10051, 10053, 10054, 10055,
    10063, 10209,
    10401, 10402, 10403, 10404, 10405, 10406, 10407, 10408, 10409, 10410, 10412, 10413, 10414,
    10415, 10416, 10418, 10419, 10421, 10426, 10428, 10430, 10433, 10435, 10437,
    10481, 10482, 10483, 10484, 10485, 10486, 10487, 10488, 10489, 10490, 10492, 10493, 10494,
    10495, 10496, 10498, 10499, 10501, 10506, 10508, 10510, 10513, 10515, 10517,
)
#: stringData, sent as whole numbers in text.
STRING_MACROS: tuple[int, ...] = (10020, 10021, 10023, 10400, 10480)
MACROS: tuple[int, ...] = FLOAT_MACROS + STRING_MACROS


class ArgonautError(IOError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status

    @property
    def permanent(self) -> bool:
        """A rejected request (bad data) is not retried; outages, timeouts and throttling are."""
        return is_permanent_rejection(self.status)


def _decimal(text: str | None) -> Decimal:
    try:
        return Decimal(text) if text not in (None, "") else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


def _float(value: Decimal) -> int | float:
    return int(value) if value == value.to_integral_value() else float(value)


def cycle_time_value(cycle_time_s: float | None) -> int | float:
    """floatData[0]: the cycle time in seconds (to the millisecond), or 0 when it is unknown."""
    if cycle_time_s is None or cycle_time_s != cycle_time_s or cycle_time_s < 0:
        return 0
    return _float(Decimal(str(round(float(cycle_time_s), 3))))


def build_payload(serial: str, part_number: int | str, consec: int, values: dict[str, str | None],
                  transaction_type_id: int = 100, cycle_time_s: float | None = None) -> dict:
    """`values` maps macro number (as text) to its captured value; a missing value is sent as 0,
    as the original collector did. `cycle_time_s` is sent as floatData[0] (0 when unknown)."""
    floats = [cycle_time_value(cycle_time_s)] + [_float(_decimal(values.get(str(n)))) for n in FLOAT_MACROS]
    strings = [str(int(_decimal(values.get(str(n))))) for n in STRING_MACROS]
    return {
        "request": {
            "sequence": int(consec),
            "transactionTypeId": int(transaction_type_id),
            "serialNumber": serial,
            "dintData": [],
            "floatData": floats,
            "stringData": strings,
            "partNumber": str(part_number),
            "partNumberCode": 0,
        }
    }


class ArgonautClient:
    def __init__(self, url: str, location_id: str = "", username: str = "", password: str = "",
                 timeout_s: float = 10.0, verify_tls: bool = True, ca_file: str = ""):
        # A pasted Argonaut address that already carries ?locationId= is used exactly as given;
        # otherwise the configured location ID is added.
        has_location = "locationid" in {k.lower() for k in urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)}
        query = {"locationId": location_id} if location_id and not has_location else {}
        self.url = url + (("&" if "?" in url else "?") + urllib.parse.urlencode(query) if query else "")
        self._auth = (
            "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode() if username or password else None
        )
        self._timeout = timeout_s
        self._context: ssl.SSLContext | None = None
        if url.lower().startswith("https"):
            self._context = ssl.create_default_context(cafile=ca_file or None)
            if not verify_tls:
                # Argonaut servers often use a self-signed certificate on a plant IP address.
                self._context.check_hostname = False
                self._context.verify_mode = ssl.CERT_NONE

    def post(self, payload: dict) -> None:
        try:
            request = urllib.request.Request(self.url, data=json.dumps(payload).encode(), method="POST")
            request.add_header("Content-Type", "application/json")
            if self._auth:
                request.add_header("Authorization", self._auth)
            with urllib.request.urlopen(request, timeout=self._timeout, context=self._context) as response:
                response.read()
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")[:200]
            raise ArgonautError(f"Argonaut answered HTTP {error.code} {body}".strip(), error.code) from error
        except (urllib.error.URLError, OSError) as error:
            raise ArgonautError(f"Argonaut is unreachable: {getattr(error, 'reason', error)}") from error
        except ValueError as error:  # e.g. a malformed Argonaut URL saved for the machine
            raise ArgonautError(f"Argonaut URL is not usable: {error}") from error
