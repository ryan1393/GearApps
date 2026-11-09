/** Shared with Cutter Builder: unknown serials do not imply a blade capacity. */
export interface BladeCapacityBody {
  dana_serial_number?: string | null;
  mf_serial_number?: string | null;
  definition?: { blade_family_name?: string | null } | null;
}
export function cutterBodyBladeCapacity(body: BladeCapacityBody | null): number | null {
  if (!body) return null;
  const serial = String(body.dana_serial_number ?? body.mf_serial_number ?? '').replace(/[^A-Za-z0-9]/g, '');
  const size = serial.match(/(?:064|076|088|105)/)?.[0] ?? '';
  if (size === '064') return 11;
  if (size === '076') return 13;
  if (size === '088') return 17;
  if (size === '105') return serial.charAt(7) === '8' ? 13 : 19;
  return null;
}
export function cutterBodyMatchesRequirement(body: BladeCapacityBody, count: number, partTypeCode: string): boolean {
  const family = body.definition?.blade_family_name?.trim().toUpperCase();
  return Number.isInteger(count) && count > 0 && cutterBodyBladeCapacity(body) === count &&
    (!family || !['RING', 'PINION'].includes(family) || family === partTypeCode.trim().toUpperCase());
}
