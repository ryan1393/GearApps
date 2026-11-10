"""Settings come from environment variables so one image serves every lapper."""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass
from urllib.parse import urlparse


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    machine_ip: str
    scanner_ip: str
    machine_number: str | None = None
    scanner_input1_port: int = 9004
    focas_port: int = 8193
    focas_library: str = "/opt/fanuc/libfwlib32.so"
    focas_log: str = "/data/focas.log"
    poll_interval_ms: int = 250
    retry_delay_ms: int = 5000
    io_timeout_ms: int = 3000
    state_dir: str = "/data"
    api_base_url: str = "http://gear-app-server:3333"
    api_email: str = ""
    api_password: str = ""
    api_timeout_s: float = 10.0

    @property
    def state_file(self) -> str:
        name = self.machine_ip.replace(":", "_")
        if self.machine_number:
            name += "-" + "".join(c if c.isalnum() or c in "-_" else "_" for c in self.machine_number)
        return os.path.join(self.state_dir, name + ".json")

    @property
    def heartbeat_file(self) -> str:
        return self.state_file[: -len(".json")] + ".heartbeat"

    def validate(self, collecting: bool = True) -> "Settings":
        """`collecting=False` (the one-off `check` read) only needs the controller address."""
        addresses = [("LAPPER_MACHINE_IP", self.machine_ip)]
        if collecting:
            addresses.append(("LAPPER_SCANNER_IP", self.scanner_ip))
        for label, value in addresses:
            try:
                ipaddress.ip_address(value)
            except ValueError as error:
                raise ConfigError(f"{label} must be an IP address (got {value!r}).") from error
        for label, port in (("LAPPER_SCANNER_INPUT1_PORT", self.scanner_input1_port), ("FOCAS_PORT", self.focas_port)):
            if not 0 < port <= 65535:
                raise ConfigError(f"{label} must be a TCP port.")
        if min(self.poll_interval_ms, self.retry_delay_ms, self.io_timeout_ms) <= 0 or self.api_timeout_s <= 0:
            raise ConfigError("Polling intervals and timeouts must be positive.")
        url = urlparse(self.api_base_url)
        if url.scheme not in ("http", "https") or not url.netloc:
            raise ConfigError("GEARAPPS_API_BASE_URL must be an http(s) URL.")
        if collecting and (not self.api_email or not self.api_password):
            raise ConfigError("Set GEARAPPS_API_EMAIL and GEARAPPS_API_PASSWORD (an active GearApps account).")
        if not self.state_dir:
            raise ConfigError("LAPPER_STATE_DIR is required.")
        return self


def _int(env: dict[str, str], name: str, default: int) -> int:
    raw = env.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError as error:
        raise ConfigError(f"{name} must be a whole number.") from error


def from_env(env: dict[str, str] | None = None, collecting: bool = True) -> Settings:
    env = dict(os.environ if env is None else env)
    return Settings(
        machine_ip=env.get("LAPPER_MACHINE_IP", "").strip(),
        scanner_ip=env.get("LAPPER_SCANNER_IP", "").strip(),
        machine_number=env.get("LAPPER_MACHINE_NUMBER", "").strip() or None,
        scanner_input1_port=_int(env, "LAPPER_SCANNER_INPUT1_PORT", 9004),
        focas_port=_int(env, "FOCAS_PORT", 8193),
        focas_library=env.get("FOCAS_LIBRARY", "/opt/fanuc/libfwlib32.so").strip(),
        focas_log=env.get("FOCAS_LOG", "").strip() or os.path.join(env.get("LAPPER_STATE_DIR", "/data"), "focas.log"),
        poll_interval_ms=_int(env, "LAPPER_POLL_INTERVAL_MS", 250),
        retry_delay_ms=_int(env, "LAPPER_RETRY_DELAY_MS", 5000),
        io_timeout_ms=_int(env, "LAPPER_IO_TIMEOUT_MS", 3000),
        state_dir=env.get("LAPPER_STATE_DIR", "/data").strip(),
        api_base_url=env.get("GEARAPPS_API_BASE_URL", "http://gear-app-server:3333").strip().rstrip("/"),
        api_email=env.get("GEARAPPS_API_EMAIL", "").strip(),
        api_password=env.get("GEARAPPS_API_PASSWORD", ""),
        api_timeout_s=float(env.get("GEARAPPS_API_TIMEOUT_S", "10") or 10),
    ).validate(collecting)
