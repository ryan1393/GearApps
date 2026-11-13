import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';

/** Configured locations for the RXO latest-snapshot folder and plant time zone. */
export function rxoLatestRoot(config: ConfigService) {
  return path.resolve(config.get<string>('TRUCK_LOG_RXO_LATEST_DIR', 'data/rxo/latest'));
}

export function rxoPlantTimeZone(config: ConfigService) {
  return config.get<string>('TZ', 'America/Indiana/Indianapolis');
}

/** Written by tools/truck-log/rxo/verify-local-rxo-latest.mjs after it verifies a copied snapshot. */
export const RXO_BOUNDARY_FILE = 'truck-log-ingestion-boundary.json';

export function rxoBoundaryPath(config: ConfigService) {
  return path.join(rxoLatestRoot(config), RXO_BOUNDARY_FILE);
}
