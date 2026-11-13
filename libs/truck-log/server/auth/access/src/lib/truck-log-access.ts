import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { TruckLogAccessScope } from '@truck-log/server/data-access';

export const TRUCK_LOG_ACCESS_SCOPES = 'truck-log:access-scopes';

export const RequireTruckLogAccess = (...scopes: TruckLogAccessScope[]) =>
  SetMetadata(TRUCK_LOG_ACCESS_SCOPES, scopes);

export interface AuthenticatedTruckLogPrincipal {
  subjectId: string;
  displayName: string;
  keyId: string;
  scopes: TruckLogAccessScope[];
}

export interface TruckLogAccessRequest extends Request {
  truckLogPrincipal?: AuthenticatedTruckLogPrincipal;
}
