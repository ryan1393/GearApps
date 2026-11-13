import { SetMetadata } from '@nestjs/common';
import type { StationIdentity } from '@truck-log/shared/contracts';

export const STATION_PUBLIC_METADATA = 'truck-log:station-public';

/**
 * Marks a controller or route that does not need a paired station or an
 * administrator: health checks, sign-in endpoints, and machine routes that are
 * protected by their own token guard (Print Agent, scoped access credentials).
 */
export const StationPublic = () => SetMetadata(STATION_PUBLIC_METADATA, true);

/** Set by the station guard on every authorized browser request. */
export interface StationAuthorizedRequest {
  truckLogStation?: StationIdentity | null;
  truckLogAdminName?: string | null;
}

/**
 * The name recorded in audit history for a guard action. The server decides it
 * from the signed-in station (or administrator), never from the request body.
 */
export function stationActor(request: StationAuthorizedRequest, fallback?: string | null): string {
  if (request.truckLogStation) return `Station: ${request.truckLogStation.name}`.slice(0, 120);
  if (request.truckLogAdminName) return `Admin: ${request.truckLogAdminName}`.slice(0, 120);
  return (fallback && fallback.trim()) || 'Guard';
}
