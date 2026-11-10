"""python -m lapper_read          run the collector
python -m lapper_read check     read the controller once and print signals and macros
python -m lapper_read health    exit 0 when the sampler wrote a heartbeat recently"""

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
from .worker import Worker, heartbeat_age_s


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", stream=sys.stdout)
    command = argv[1] if len(argv) > 1 else "run"
    try:
        settings = from_env(collecting=command != "check")
    except ConfigError as error:
        logging.critical("Configuration error: %s", error)
        return 2

    if command == "health":
        try:
            age = heartbeat_age_s(settings.heartbeat_file)
        except OSError:
            return 1
        return 0 if age < max(60, settings.retry_delay_ms / 1000 * 3) else 1

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

    logging.info("Starting Lapper Read %s for %s", __version__, settings.machine_ip)
    scanner = Scanner(settings.scanner_ip, settings.scanner_input1_port, settings.io_timeout_ms / 1000)
    worker = Worker(settings, api, fanuc, scanner, CycleStateStore(settings.state_file))
    signal.signal(signal.SIGTERM, worker.stop)
    signal.signal(signal.SIGINT, worker.stop)
    worker.run()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
