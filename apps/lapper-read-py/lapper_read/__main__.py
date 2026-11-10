"""python -m lapper_read supervise  one worker per machine saved in GearApps (Docker default)
python -m lapper_read run        one worker for LAPPER_MACHINE_IP / LAPPER_SCANNER_IP
python -m lapper_read check      read the controller once and print signals and macros
python -m lapper_read health     exit 0 when the supervisor (or single worker) is alive"""

from __future__ import annotations

import logging
import signal
import sys

from . import __version__
from .api import GearAppsApi
from .config import ConfigError, from_env
from .fanuc import MACRO_CONSEC, MACRO_IDENT, Fanuc
from .focas import FocasTransport
from .scanner import Scanner
from .state import CycleStateStore
from .supervisor import Supervisor, supervisor_heartbeat
from .worker import Worker, heartbeat_age_s


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stdout)
    command = argv[1] if len(argv) > 1 else "supervise"
    if command not in ("supervise", "run", "check", "health"):
        print(__doc__)
        return 2
    try:
        settings = from_env(mode=command)
    except ConfigError as error:
        logging.critical("Configuration error: %s", error)
        return 2

    if command == "health":
        # Supervisor mode: healthy while machine discovery keeps running.
        path = settings.heartbeat_file if settings.machine_ip else supervisor_heartbeat(settings)
        limit = max(60, settings.retry_delay_ms / 1000 * 3, settings.discover_interval_s * 3)
        try:
            return 0 if heartbeat_age_s(path) < limit else 1
        except OSError:
            return 1

    api = GearAppsApi(settings.api_base_url, settings.api_email, settings.api_password, settings.api_timeout_s)
    transport = FocasTransport(settings.focas_library, settings.focas_log, settings.focas_port)
    fanuc = Fanuc(transport, settings.machine_ip, settings.io_timeout_ms, api)

    if command == "check":
        state = fanuc.read_state()
        print(f"Machine {settings.machine_ip}: ident #{MACRO_IDENT}={state.ident} consec #{MACRO_CONSEC}={state.consec}")
        print(f"  X6.7 front door closed={state.door_closed}  X1.2 cycle start={state.start_cycle}  Y3.2 in cycle={state.in_cycle}")
        for number in (int(n) for n in argv[2:]):
            print(f"  #{number} = {fanuc.macro(number)}")
        fanuc.close()
        return 0

    if command == "supervise":
        logging.info("Starting Lapper Read %s supervisor", __version__)
        supervisor = Supervisor(settings, api)
        signal.signal(signal.SIGTERM, supervisor.stop)
        signal.signal(signal.SIGINT, supervisor.stop)
        supervisor.run()
        return 0

    logging.info("Starting Lapper Read %s for %s", __version__, settings.machine_ip)
    scanner = Scanner(settings.scanner_ip, settings.scanner_input1_port, settings.io_timeout_ms / 1000)
    worker = Worker(settings, api, fanuc, scanner, CycleStateStore(settings.state_file))
    signal.signal(signal.SIGTERM, worker.stop)
    signal.signal(signal.SIGINT, worker.stop)
    worker.run()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
