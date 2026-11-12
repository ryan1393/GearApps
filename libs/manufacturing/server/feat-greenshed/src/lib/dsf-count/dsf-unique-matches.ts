/* DSF sources that match exactly one MeshForge machine, for Admin > DSF Mappings "Map unique matches".
 *
 * Pure: no database access. A source matches a machine when it is in the same department and its
 * whiteboard name ends in the machine number ("132 PIN CUTTER 549" -> machine 549 in department
 * 132). A match is only proposed when it is unambiguous on both sides and the machine has nothing
 * an administrator chose or needs to review. Saving still goes through the normal Admin save, with
 * all of its checks.
 */

export interface UniqueMatchMachine {
  machine_id: string; machine_number: string; department: string; active: boolean;
}
export interface UniqueMatchSource {
  mapping_id: string; department: string; whiteboard_name: string; line_name: string;
  mapping_active: boolean; whiteboard_active: boolean; operation_line_matches: boolean; running_reasons: number;
}
export interface UniqueMatchInput {
  machines: readonly UniqueMatchMachine[];
  sources: readonly UniqueMatchSource[];
  /** Machines with a row in Admin mappings: mapped or deliberately unmapped. Never proposed. */
  adminDecided: ReadonlySet<string>;
  /** mapping_id -> machine_id for every source a machine already uses (Admin or reference). */
  assigned: ReadonlyMap<string, string>;
  /** Machines with DSF cutter-crediting history. Only re-mappable by hand. */
  withHistory: ReadonlySet<string>;
}
export interface UniqueMatch {
  machine_id: string; machine_number: string; department: string;
  mapping_id: string; whiteboard_name: string; line_name: string;
}
export type UniqueMatchSkip = 'NO_SOURCE' | 'SEVERAL_SOURCES' | 'SEVERAL_MACHINES' | 'SOURCE_IN_USE' | 'CREDITING_HISTORY';
export interface UniqueMatchResult {
  matches: UniqueMatch[];
  /** Active machines with no Admin decision that were not matched, and why. */
  skipped: { machine_id: string; machine_number: string; department: string; reason: UniqueMatchSkip }[];
}

/** The machine number a whiteboard name ends in, or null. */
export function trailingMachineNumber(name: string): string | null {
  return /([0-9]+)\s*$/.exec(name)?.[1] ?? null;
}

export function eligibleSource(source: UniqueMatchSource): boolean {
  return source.mapping_active && source.whiteboard_active && source.operation_line_matches && source.running_reasons > 0;
}

export function findUniqueMatches(input: UniqueMatchInput): UniqueMatchResult {
  const key = (department: string, number: string) => department + '|' + number;
  const sourcesByKey = new Map<string, UniqueMatchSource[]>();
  for (const source of input.sources) {
    if (!eligibleSource(source)) continue;
    const number = trailingMachineNumber(source.whiteboard_name);
    if (!number) continue;
    const k = key(source.department, number);
    sourcesByKey.set(k, [...(sourcesByKey.get(k) ?? []), source]);
  }
  const machinesByKey = new Map<string, number>();
  for (const machine of input.machines) {
    const k = key(machine.department, machine.machine_number);
    machinesByKey.set(k, (machinesByKey.get(k) ?? 0) + 1);
  }

  const result: UniqueMatchResult = { matches: [], skipped: [] };
  for (const machine of input.machines) {
    if (!machine.active || input.adminDecided.has(machine.machine_id)) continue;
    const skip = (reason: UniqueMatchSkip) => result.skipped.push({
      machine_id: machine.machine_id, machine_number: machine.machine_number, department: machine.department, reason,
    });
    const k = key(machine.department, machine.machine_number);
    const sources = sourcesByKey.get(k) ?? [];
    if (sources.length === 0) { skip('NO_SOURCE'); continue; }
    if (sources.length > 1) { skip('SEVERAL_SOURCES'); continue; }
    if ((machinesByKey.get(k) ?? 0) !== 1) { skip('SEVERAL_MACHINES'); continue; }
    const source = sources[0];
    const owner = input.assigned.get(source.mapping_id);
    if (owner && owner !== machine.machine_id) { skip('SOURCE_IN_USE'); continue; }
    if (input.withHistory.has(machine.machine_id)) { skip('CREDITING_HISTORY'); continue; }
    result.matches.push({
      machine_id: machine.machine_id, machine_number: machine.machine_number, department: machine.department,
      mapping_id: source.mapping_id, whiteboard_name: source.whiteboard_name, line_name: source.line_name,
    });
  }
  const order = (a: { department: string; machine_number: string }, b: { department: string; machine_number: string }) =>
    a.department.localeCompare(b.department, undefined, { numeric: true }) ||
    a.machine_number.localeCompare(b.machine_number, undefined, { numeric: true });
  result.matches.sort(order);
  result.skipped.sort(order);
  return result;
}
