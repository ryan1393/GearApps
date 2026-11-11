/** The blade operations shown as tabs on the operations station, in workflow order. */
export const BLADE_OPERATIONS = [
  { key: 'intake', label: 'Blade Intake', icon: 'intake' },
  { key: 'grinding', label: 'Grinding', icon: 'cutter' },
  { key: 'load-container', label: 'Load Container', icon: 'container' },
  { key: 'coater-shipments', label: 'Coater Shipments', icon: 'container' },
  { key: 'receive-container', label: 'Receive From Coater', icon: 'receive' },
  { key: 'internal-movement', label: 'Internal Movement', icon: 'move' },
] as const;

export type BladeOperationKey = (typeof BLADE_OPERATIONS)[number]['key'];

export function isBladeOperation(value: unknown): value is BladeOperationKey {
  return BLADE_OPERATIONS.some((operation) => operation.key === value);
}
