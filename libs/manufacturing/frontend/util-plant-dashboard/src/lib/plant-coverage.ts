import { sourceCatalogFresh } from './cuttergrind-coverage';
import type { DepartmentCoverage, DsfMappingSnapshot, MachineCount } from '@meshforge/shared/domain';

// Scope observed in the user's running DSF department overview. This is a
// reconciliation baseline, not a limit on discovery or a seed of fake machines.
// CUTTER GRIND is mapped to MeshForge Department 45 by the existing DSF reader.
export const REFERENCE_DEPARTMENTS: readonly string[] = [
  '45', '121', '131', '132', '152', '181', '191', '200',
  '240', '310', '341', '350', '400', '541', '600',
];

/** The reference in words, e.g. "Cuttergrind and Departments 121, 131, … and 600". */
export function referenceDepartmentsText(codes: readonly string[] = REFERENCE_DEPARTMENTS): string {
  const others = codes.filter(code => code !== '45');
  const list = others.length > 2 ? `${others.slice(0, -1).join(', ')}, and ${others[others.length - 1]}` : others.join(' and ');
  const departments = others.length ? `${others.length === 1 ? 'Department' : 'Departments'} ${list}` : '';
  return codes.includes('45') ? (departments ? `Cuttergrind and ${departments}` : 'Cuttergrind') : departments;
}

export function plantDepartmentCoverage(machines: MachineCount[], snapshot: DsfMappingSnapshot | null, now: number): DepartmentCoverage[] {
  const fresh = sourceCatalogFresh(snapshot, now);
  const codes = new Set([...REFERENCE_DEPARTMENTS, ...machines.map(machine => machine.department),
    ...(snapshot?.source_options ?? []).map(source => source.department)]);
  return [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(code => {
    const registered = machines.filter(machine => machine.department === code);
    const machineIds = new Set(registered.map(machine => machine.machine_id));
    const sources = (snapshot?.source_options ?? []).filter(source => source.department === code);
    return {
      code, inReference: REFERENCE_DEPARTMENTS.includes(code), registered: registered.length,
      sourceMappings: fresh ? sources.length : null,
      unlinkedActiveSources: fresh ? sources.filter(source => source.mapping_active && source.whiteboard_active &&
        !machineIds.has(source.assigned_machine_id ?? '')).length : null,
    };
  });
}
