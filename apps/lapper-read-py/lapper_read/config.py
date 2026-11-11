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
    api_base_url: str = "http://meshforge-server:3333"
    api_email: str = ""
    api_password: str = ""
    #: Collector token from Lapper > Configuration > Collector Tokens; replaces email/password.
    api_token: str = ""
    #: File the MeshForge API writes the Docker collector's token to (Lapper > Collector Tokens >
    #: Connect Docker collector). Used when no api_token is set; re-read when the API rejects it.
    api_token_file: str = ""
    api_timeout_s: float = 10.0
    #: Supervisor: names this machine's checkpoint (its MeshForge id) so it survives IP changes.
    state_key: str | None = None
    #: Supervisor: how often the machine list is re-read from MeshForge.
    discover_interval_s: int = 30
    #: Supervisor: status/health HTTP port inside the container (0 disables it).
    status_port: int = 8080
    #: Argonaut (Track and Trace): post each completed cycle's macros. Off unless enabled.
    argonaut_enabled: bool = False
    argonaut_url: str = ""
    argonaut_location_id: str = ""
    argonaut_username: str = ""
    argonaut_password: str = ""
    argonaut_transaction_type_id: int = 100
    argonaut_verify_tls: bool = True
    argonaut_ca_file: str = ""
    argonaut_timeout_s: float = 10.0

    @property
    def state_file(self) -> str:
        if self.state_key:
            return os.path.join(self.state_dir, "machine-" + _safe(self.state_key) + ".json")
        name = self.machine_ip.replace(":", "_")
        if self.machine_number:
            name += "-" + _safe(self.machine_number)
        return os.path.join(self.state_dir, name + ".json")

    @property
    def heartbeat_file(self) -> str:
        return self.state_file[: -len(".json")] + ".heartbeat"

    def validate(self, mode: str = "run") -> "Settings":
        """Modes: `run` one machine, `supervise` every machine, `check` one controller read."""
        addresses = []
        if mode in ("run", "check"):
            addresses.append(("LAPPER_MACHINE_IP", self.machine_ip))
        if mode == "run" and self.scanner_ip:
            # Optional: without a scanner the cycles are recorded without a serial.
            addresses.append(("LAPPER_SCANNER_IP", self.scanner_ip))
        for label, value in addresses:
            try:
                ipaddress.ip_address(value)
            except ValueError as error:
                raise ConfigError(f"{label} must be an IP address (got {value!r}).") from error
        for label, port in (("LAPPER_SCANNER_INPUT1_PORT", self.scanner_input1_port), ("FOCAS_PORT", self.focas_port)):
            if not 0 < port <= 65535:
                raise ConfigError(f"{label} must be a TCP port.")
        if not 0 <= self.status_port <= 65535:
            raise ConfigError("LAPPER_STATUS_PORT must be a TCP port or 0.")
        if min(self.poll_interval_ms, self.retry_delay_ms, self.io_timeout_ms, self.discover_interval_s) <= 0 \
                or self.api_timeout_s <= 0:
            raise ConfigError("Polling intervals and timeouts must be positive.")
        url = urlparse(self.api_base_url)
        if url.scheme not in ("http", "https") or not url.netloc:
            raise ConfigError("MESHFORGE_API_BASE_URL must be an http(s) URL.")
        if self.api_token and not self.api_token.startswith("glr_"):
            raise ConfigError("MESHFORGE_API_TOKEN must be a collector token from Lapper (it starts with glr_).")
        if mode in ("run", "supervise") and not self.api_token and not self.api_token_file \
                and (not self.api_email or not self.api_password):
            raise ConfigError(
                "Connect the Docker collector in Lapper > Configuration > Collector Tokens (MESHFORGE_API_TOKEN_FILE), "
                "or set MESHFORGE_API_TOKEN, or MESHFORGE_API_EMAIL and MESHFORGE_API_PASSWORD."
            )
        if self.argonaut_enabled:
            target = urlparse(self.argonaut_url)
            if target.scheme not in ("http", "https") or not target.netloc:
                raise ConfigError("ARGONAUT_URL must be an http(s) URL when ARGONAUT_ENABLED is on.")
            if self.argonaut_timeout_s <= 0:
                raise ConfigError("ARGONAUT_TIMEOUT_S must be positive.")
        if not self.state_dir:
            raise ConfigError("LAPPER_STATE_DIR is required.")
        return self


def _safe(text: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in text)


def _int(env: dict[str, str], name: str, default: int) -> int:
    raw = env.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError as error:
        raise ConfigError(f"{name} must be a whole number.") from error


def _bool(env: dict[str, str], name: str, default: bool) -> bool:
    raw = env.get(name, "").strip().lower()
    if not raw:
        return default
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    raise ConfigError(f"{name} must be true or false.")


def _float(env: dict[str, str], name: str, default: float) -> float:
    raw = env.get(name, "").strip()
    try:
        return float(raw) if raw else default
    except ValueError as error:
        raise ConfigError(f"{name} must be a number.") from error


def from_env(env: dict[str, str] | None = None, mode: str = "run") -> Settings:
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
        api_base_url=env.get("MESHFORGE_API_BASE_URL", "http://meshforge-server:3333").strip().rstrip("/"),
        api_email=env.get("MESHFORGE_API_EMAIL", "").strip(),
        api_password=env.get("MESHFORGE_API_PASSWORD", ""),
        api_token=env.get("MESHFORGE_API_TOKEN", "").strip(),
        api_token_file=env.get("MESHFORGE_API_TOKEN_FILE", "").strip(),
        api_timeout_s=float(env.get("MESHFORGE_API_TIMEOUT_S", "10") or 10),
        discover_interval_s=_int(env, "LAPPER_DISCOVER_INTERVAL_S", 30),
        status_port=_int(env, "LAPPER_STATUS_PORT", 8080),
        argonaut_enabled=_bool(env, "ARGONAUT_ENABLED", False),
        argonaut_url=env.get("ARGONAUT_URL", "").strip(),
        argonaut_location_id=env.get("ARGONAUT_LOCATION_ID", "").strip(),
        argonaut_username=env.get("ARGONAUT_USERNAME", "").strip(),
        argonaut_password=env.get("ARGONAUT_PASSWORD", ""),
        argonaut_transaction_type_id=_int(env, "ARGONAUT_TRANSACTION_TYPE_ID", 100),
        argonaut_verify_tls=_bool(env, "ARGONAUT_VERIFY_TLS", True),
        argonaut_ca_file=env.get("ARGONAUT_CA_FILE", "").strip(),
        argonaut_timeout_s=_float(env, "ARGONAUT_TIMEOUT_S", 10.0),
    ).validate(mode)
