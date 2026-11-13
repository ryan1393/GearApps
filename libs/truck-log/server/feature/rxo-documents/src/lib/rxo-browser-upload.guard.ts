import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type RxoBrowserUploadHeaders = Record<string, string | string[] | undefined>;

function singleHeader(headers: RxoBrowserUploadHeaders, name: string): string {
  const value = headers[name];
  return typeof value === 'string' ? value : '';
}

function validOrigin(value: string): URL | null {
  if (!value || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Cross-origin request protection, NOT user authentication. This action is
 * intentionally available to anyone who can reach the internal Truck Log app.
 * Never trust an uploader name, role, credential or forwarded host from input.
 */
export function rxoBrowserUploadRequestError(
  headers: RxoBrowserUploadHeaders,
  configuredOrigins = '',
  configuredWebPort = '4300',
): string | null {
  if (singleHeader(headers, 'x-truck-log-upload') !== 'browser-v1') {
    return 'Use the Upload PDF button in Truck Log.';
  }
  if (!/^multipart\/form-data(?:;|$)/i.test(singleHeader(headers, 'content-type'))) {
    return 'Upload one PDF using the Truck Log file picker.';
  }
  const origin = validOrigin(singleHeader(headers, 'origin'));
  if (!origin) return 'The browser must send a valid Truck Log page origin.';
  const fetchSite = singleHeader(headers, 'sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return 'Cross-origin RXO browser uploads are not allowed.';
  }
  const configured = configuredOrigins.split(',').map(value => value.trim());
  if (configured.some(value => validOrigin(value)?.origin === origin.origin)) return null;

  // Both shipped Nginx configurations use Host $host and omit the external
  // port. The development proxy changes Host to the API port. Accept the
  // same hostname at the configured web port (4300 by default), in addition
  // to an exact Host/Origin authority. No forwarded headers are consulted.
  const host = singleHeader(headers, 'host');
  if (!host || host.length > 255 || /[\s,/@\\?#]/.test(host)) {
    return 'The Truck Log request host is invalid.';
  }
  let target: URL;
  try {
    target = new URL(`${origin.protocol}//${host}`);
  } catch {
    return 'The Truck Log request host is invalid.';
  }
  if (target.hostname !== origin.hostname) {
    return 'Open Truck Log on its normal address before uploading a PDF.';
  }
  const webPort = /^\d{1,5}$/.test(configuredWebPort)
    && Number(configuredWebPort) >= 1 && Number(configuredWebPort) <= 65535
    ? String(Number(configuredWebPort)) : '4300';
  const originPort = origin.port || (origin.protocol === 'https:' ? '443' : '80');
  const targetPort = target.port || (target.protocol === 'https:' ? '443' : '80');
  if (originPort !== targetPort && originPort !== webPort) {
    return 'The PDF upload must come from the Truck Log web address.';
  }
  return null;
}

@Injectable()
export class RxoBrowserUploadGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: RxoBrowserUploadHeaders }>();
    const error = rxoBrowserUploadRequestError(
      request.headers,
      this.config.get<string>('TRUCK_LOG_CORS_ORIGINS') ?? '',
      String(this.config.get<string>('TRUCK_LOG_WEB_PORT') ?? '4300'),
    );
    if (error) throw new ForbiddenException(error);
    return true;
  }
}
