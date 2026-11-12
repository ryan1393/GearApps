export type MeshForgeAppKey =
  | 'BLADE_TRACKING'
  | 'CUTTER_BUILDER'
  | 'GREENSHED';

/**
 * Department codes are the stable legacy Department_ID values loaded into
 * departments.code by the base-data importer.
 *
 * Cross-department users may open dashboards, but only these departments
 * may perform operational transactions in each application. Admin role
 * always bypasses department restrictions.
 */
export const MESHFORGE_APP_EDITOR_DEPARTMENT_CODES: Readonly<
  Record<MeshForgeAppKey, readonly string[]>
> = {
  BLADE_TRACKING: ['45'], // CUTTER GRIND
  CUTTER_BUILDER: ['45'], // CUTTER GRIND
  GREENSHED: ['48'], // GEAR QUALITY
} as const;

export const MESHFORGE_APP_EDITOR_DEPARTMENT_NAMES: Readonly<
  Record<MeshForgeAppKey, string>
> = {
  BLADE_TRACKING: 'Cutter Grind',
  CUTTER_BUILDER: 'Cutter Grind',
  GREENSHED: 'Gear Quality',
} as const;

export function canEditMeshForgeApp(
  app: MeshForgeAppKey,
  role: string | null | undefined,
  departmentCode: string | null | undefined,
  permissions?: readonly string[] | null,
): boolean {
  if (String(role ?? '').toLowerCase() === 'admin') return true;
  if (permissions != null) {
    const prefixes: Record<MeshForgeAppKey, readonly string[]> = {
      BLADE_TRACKING: ['bladeTrays:', 'trays:', 'containerTrays:', 'coater-shipments:', 'locationTrays:', 'blades:'],
      CUTTER_BUILDER: ['cutter-builder:'],
      GREENSHED: ['greenshed:'],
    };
    if (!permissions.some(key => prefixes[app].some(prefix => key.startsWith(prefix)) && /:(create|update|delete|start|complete|place|remove|unload|dispatch|receive|scrap|record|setup|teardown|pull|move|add|save|qualityCheck|assign|print|review|prepare|email|labels|cancel)/i.test(key))) return false;
  }
  const code = String(departmentCode ?? '').trim();
  return Boolean(code) &&
    MESHFORGE_APP_EDITOR_DEPARTMENT_CODES[app].includes(code);
}

/** Display checks only; current grants and legacy safeguards are enforced by the API. */
export function canUseMeshForgeAction(user: { role?: string; permissions?: readonly string[] | null } | null | undefined, action: string): boolean {
  return Boolean(user) && (user?.role === 'admin' || user?.permissions == null || user.permissions.includes(action));
}
