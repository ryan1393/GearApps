import path from 'node:path';
import process from 'node:process';
import { PAGE_CASES } from './rxo-filter-ui.mjs';

/**
 * Standard RXO exporter configuration: environment settings, the Fort Wayne
 * site identity and the six page/direction datasets. No I/O happens here.
 */
const RXO_URL =
  process.env.RXO_URL ||
  'https://customer.rxoconnect.rxo.com/control-tower/scorecard';

const RXO_SITE_KEY = String(
  process.env.RXO_SITE_KEY || 'fort-wayne'
).trim();

const RXO_SITE_NAME = String(
  process.env.RXO_SITE_NAME || 'Dana Fort Wayne'
).trim();

// Fort Wayne must always search BOTH RXO identifiers.
// The 12808 selector intentionally matches every visible duplicate-looking
// 12808 row because RXO currently presents multiple entries with that code.
const RXO_SITE_CODE_PREFIXES = String(
  process.env.RXO_SITE_CODE_PREFIXES || '12808'
)
  .split('|')
  .map(value => value.trim())
  .filter(Boolean);

const RXO_SITE_TEXT_IDENTIFIERS = String(
  process.env.RXO_SITE_TEXT_IDENTIFIERS || 'DANA_USA_FORT_WAYNE_IN'
)
  .split('|')
  .map(value => value.trim())
  .filter(Boolean);

const EXPORT_ALL_FALLBACK = !/^(0|false|no)$/i.test(
  process.env.RXO_EXPORT_ALL_FALLBACK || 'true'
);

const DATA_DIR = path.resolve(process.env.RXO_DATA_DIR || '/app/data');
const PROFILE_DIR = path.resolve(
  process.env.RXO_PROFILE_DIR || '/app/state/profile'
);

const USERNAME_FILE =
  process.env.RXO_USERNAME_FILE || '/run/secrets/rxo_username';

const PASSWORD_FILE =
  process.env.RXO_PASSWORD_FILE || '/run/secrets/rxo_password';

const HEADLESS = !/^(0|false|no)$/i.test(
  process.env.RXO_HEADLESS || 'true'
);

const SYNC_ON_START = !/^(0|false|no)$/i.test(
  process.env.RXO_SYNC_ON_START || 'true'
);

const FORCE_LOGIN_EACH_RUN = /^(1|true|yes)$/i.test(
  process.env.RXO_FORCE_LOGIN_EACH_RUN || 'false'
);

const CAPTURE_FAILURE_SCREENSHOT = !/^(0|false|no)$/i.test(
  process.env.RXO_CAPTURE_FAILURE_SCREENSHOT || 'false'
);

const INTERVAL_MINUTES = Math.max(
  1,
  Number(process.env.RXO_SYNC_INTERVAL_MINUTES || 30)
);

const LOGIN_TIMEOUT_MS = Math.max(
  30000,
  Number(process.env.RXO_LOGIN_TIMEOUT_MS || 120000)
);

const DOWNLOAD_TIMEOUT_MS = Math.max(
  30000,
  Number(process.env.RXO_DOWNLOAD_TIMEOUT_MS || 180000)
);

const MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.RXO_MAX_ATTEMPTS || 3)
);

const RETRY_DELAY_SECONDS = Math.max(
  1,
  Number(process.env.RXO_RETRY_DELAY_SECONDS || 20)
);

const RUN_ONCE = process.argv.includes('--once');
const LOGIN_ONLY = process.argv.includes('--login-only');

const PRODUCTION_VERSION = process.env.TRUCK_LOG_RELEASE || '1.0.9';

const PRODUCTION_PAGES =
  PAGE_CASES.map(
    pageCase => ({
      ...pageCase,
      exportKey:
        pageCase.key,
    })
  );

const EXPORT_DIRECTIONS = [
  {
    filter:
      'Origin',
    direction:
      'OUTBOUND',
    file:
      'Outbound.xlsx',
  },
  {
    filter:
      'Destination',
    direction:
      'INBOUND',
    file:
      'Inbound.xlsx',
  },
];

export {
  RXO_URL,
  RXO_SITE_KEY,
  RXO_SITE_NAME,
  RXO_SITE_CODE_PREFIXES,
  RXO_SITE_TEXT_IDENTIFIERS,
  EXPORT_ALL_FALLBACK,
  DATA_DIR,
  PROFILE_DIR,
  USERNAME_FILE,
  PASSWORD_FILE,
  HEADLESS,
  SYNC_ON_START,
  FORCE_LOGIN_EACH_RUN,
  CAPTURE_FAILURE_SCREENSHOT,
  INTERVAL_MINUTES,
  LOGIN_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  MAX_ATTEMPTS,
  RETRY_DELAY_SECONDS,
  RUN_ONCE,
  LOGIN_ONLY,
  PRODUCTION_VERSION,
  PRODUCTION_PAGES,
  EXPORT_DIRECTIONS,
};
