export type DanaAppKey =
  | 'bladeTracking'
  | 'cutterBuilder'
  | 'greenshed'
  | 'lapper'
  | 'truckLog';

export const DANA_APP_DEFAULT_PORTS: Record<DanaAppKey, number> = {
  bladeTracking: 4200,
  cutterBuilder: 4201,
  greenshed: 4202,
  lapper: 4203,
  truckLog: 4300,
};

declare global {
  interface Window {
    __DANA_APPS_URLS__?: Partial<Record<DanaAppKey, string>>;
  }
}

export function getDanaAppUrl(app: DanaAppKey): string {
  if (typeof window === 'undefined') return '';
  const configured = window.__DANA_APPS_URLS__?.[app]?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${window.location.protocol}//${window.location.hostname}:${DANA_APP_DEFAULT_PORTS[app]}`;
}
