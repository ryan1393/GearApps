/* Rough DSF matches for Admin > DSF Mappings "Rough Match".
 *
 * Pure: no database access. Goes through every DSF source and every active MeshForge machine and
 * pairs them by the machine number, more loosely than "Map unique matches":
 *  - ENDS_IN_NUMBER   the whiteboard name ends in the machine number   ("132 PIN CUTTER 549" -> 549)
 *  - NAME_HAS_NUMBER  the number is anywhere in the whiteboard name    ("549 PIN CUTTER" -> 549)
 *  - LINE_HAS_NUMBER  the number is only in the line name              ("Line132-PIN_549" -> 549)
 *  - DIGITS_ONLY      only the digits of a lettered number match       ("GRINDER 1" -> G01)
 * Case, punctuation and leading zeros are ignored ("G01" = "g-1"). A source is only offered to a
 * machine in the same department (the Admin save refuses anything else) and only when it is
 * eligible and not already used by another machine. When one source is clearly the best for one
 * machine it is proposed; otherwise the administrator picks from the candidates. Nothing is saved
 * here: confirmed pairs still go through the normal Admin save, with all of its checks.
 */
import { eligibleSource, UniqueMatchMachine, UniqueMatchSource } from './dsf-unique-matches';

export type RoughMatchReason = 'ENDS_IN_NUMBER' | 'NAME_HAS_NUMBER' | 'LINE_HAS_NUMBER' | 'DIGITS_ONLY';
const SCORE: Record<RoughMatchReason, number> = { ENDS_IN_NUMBER: 4, NAME_HAS_NUMBER: 3, LINE_HAS_NUMBER: 2, DIGITS_ONLY: 1 };

export interface RoughMatchInput {
  machines: readonly UniqueMatchMachine[];
  sources: readonly UniqueMatchSource[];
  /** The working DSF source of each machine that has one (Admin, or a reference that is not blocked). */
  current: ReadonlyMap<string, { mapping_id: string; whiteboard_name: string; line_name: string }>;
  /** Machines an administrator deliberately unmapped. Never proposed. */
  leftUnmapped: ReadonlySet<string>;
  /** mapping_id -> machine_id for every source a machine already uses (Admin or reference). */
  assigned: ReadonlyMap<string, string>;
  /** Machines with DSF cutter-crediting history. Only re-mappable by hand. */
  withHistory: ReadonlySet<string>;
}
export interface RoughCandidate { mapping_id: string; whiteboard_name: string; line_name: string; reason: RoughMatchReason }
export type RoughMachineStatus = 'PROPOSED' | 'CHOOSE' | 'MAPPED' | 'NO_CANDIDATE' | 'LEFT_UNMAPPED' | 'CREDITING_HISTORY';
export interface RoughMachine {
  machine_id: string; machine_number: string; department: string; status: RoughMachineStatus;
  /** The source the machine uses now, and whether its name looks like this machine. */
  current_source: string | null; current_looks_right: boolean | null;
  /** The best candidate when it is clear-cut, else null. */
  proposed_mapping_id: string | null;
  /** Best first. Empty for MAPPED and LEFT_UNMAPPED machines. */
  candidates: RoughCandidate[];
}
export type RoughSourceOutcome = 'IN_USE' | 'PROPOSED' | 'CANDIDATE' | 'NO_MACHINE' | 'NOT_ELIGIBLE';
export interface RoughSource {
  mapping_id: string; department: string; whiteboard_name: string; line_name: string; outcome: RoughSourceOutcome;
  /** The machine using it (IN_USE), proposed for it (PROPOSED) or that could use it (CANDIDATE). */
  machine_numbers: string[];
  /** Departments where an active machine has the number in this source's name: a department mix-up. */
  other_departments: string[];
}
export interface RoughMatchResult { machines: RoughMachine[]; sources: RoughSource[] }

/** Uppercase, letters and digits only, leading zeros dropped from every run of digits. */
export function canonical(value: string): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '').replace(/[0-9]+/g, run => run.replace(/^0+(?=[0-9])/, ''));
}
const digitRuns = (value: string): string[] => (String(value ?? '').match(/[0-9]+/g) ?? []).map(canonical);
const words = (value: string): string[] => String(value ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).map(canonical);

/** Where in the name the machine number appears: -1 nowhere, 1 at the end, 0 elsewhere. */
function find(number: string, name: string, ignore: string | null): -1 | 0 | 1 {
  if (/^[0-9]+$/.test(number)) {
    const runs = digitRuns(name);
    if (/[0-9]+\s*$/.test(name) && runs[runs.length - 1] === number && number !== ignore) return 1;
    return runs.some(run => run === number && run !== ignore) ? 0 : -1;
  }
  // A lettered number may be split over up to three words: "G 01", "LAP-3".
  const list = words(name);
  let found: -1 | 0 | 1 = -1;
  for (let start = 0; start < list.length; start++) {
    let joined = '';
    for (let end = start; end < Math.min(list.length, start + 3); end++) {
      joined += list[end];
      if (joined === number) found = end === list.length - 1 ? 1 : (found === 1 ? 1 : 0);
    }
  }
  return found;
}

/** How a DSF source's names match a machine number, or null when they do not. */
export function roughMatch(machineNumber: string, source: { department: string; whiteboard_name: string; line_name: string }): RoughMatchReason | null {
  const number = canonical(machineNumber);
  if (!number) return null;
  const inName = find(number, source.whiteboard_name, null);
  if (inName === 1) return 'ENDS_IN_NUMBER';
  if (inName === 0) return 'NAME_HAS_NUMBER';
  // Line names carry the department ("Line132-PIN_549"); that number never identifies a machine.
  if (find(number, source.line_name, canonical(source.department)) >= 0) return 'LINE_HAS_NUMBER';
  const digits = digitRuns(machineNumber);
  if (/[A-Z]/.test(number) && digits.length === 1) {
    const runs = digitRuns(source.whiteboard_name);
    if (runs.length && runs[runs.length - 1] === digits[0]) return 'DIGITS_ONLY';
  }
  return null;
}

const byNumber = (a: { department: string; machine_number: string }, b: { department: string; machine_number: string }) =>
  a.department.localeCompare(b.department, undefined, { numeric: true }) ||
  a.machine_number.localeCompare(b.machine_number, undefined, { numeric: true });

export function findRoughMatches(input: RoughMatchInput): RoughMatchResult {
  const active = input.machines.filter(machine => machine.active);
  const eligible = input.sources.filter(eligibleSource);
  const machineNumber = new Map(input.machines.map(machine => [machine.machine_id, machine.machine_number]));

  // Machines that still need a source, and every eligible, free source in their department that matches.
  const open = active.filter(m => !input.current.has(m.machine_id) && !input.leftUnmapped.has(m.machine_id));
  const candidates = new Map<string, RoughCandidate[]>();
  for (const machine of open) {
    const list: RoughCandidate[] = [];
    for (const source of eligible) {
      if (source.department !== machine.department) continue;
      const owner = input.assigned.get(source.mapping_id);
      if (owner && owner !== machine.machine_id) continue;
      const reason = roughMatch(machine.machine_number, source);
      if (reason) list.push({ mapping_id: source.mapping_id, whiteboard_name: source.whiteboard_name, line_name: source.line_name, reason });
    }
    list.sort((a, b) => SCORE[b.reason] - SCORE[a.reason] || a.whiteboard_name.localeCompare(b.whiteboard_name, undefined, { numeric: true }));
    candidates.set(machine.machine_id, list);
  }
  // A source is proposed only when it is one machine's single best candidate and no other open
  // machine wants it as much.
  const claims = new Map<string, number[]>();
  for (const machine of open) {
    if (input.withHistory.has(machine.machine_id)) continue;
    for (const candidate of candidates.get(machine.machine_id) ?? [])
      claims.set(candidate.mapping_id, [...(claims.get(candidate.mapping_id) ?? []), SCORE[candidate.reason]]);
  }

  const machines: RoughMachine[] = [];
  const proposedFor = new Map<string, string>();
  for (const machine of active) {
    const base = { machine_id: machine.machine_id, machine_number: machine.machine_number, department: machine.department };
    const current = input.current.get(machine.machine_id);
    if (current) {
      machines.push({ ...base, status: 'MAPPED', current_source: current.whiteboard_name,
        current_looks_right: roughMatch(machine.machine_number, { department: machine.department, ...current }) !== null,
        proposed_mapping_id: null, candidates: [] });
      continue;
    }
    if (input.leftUnmapped.has(machine.machine_id)) {
      machines.push({ ...base, status: 'LEFT_UNMAPPED', current_source: null, current_looks_right: null, proposed_mapping_id: null, candidates: [] });
      continue;
    }
    const list = candidates.get(machine.machine_id) ?? [];
    let status: RoughMachineStatus = list.length ? 'CHOOSE' : 'NO_CANDIDATE';
    let proposed: string | null = null;
    if (input.withHistory.has(machine.machine_id)) status = 'CREDITING_HISTORY';
    else if (list.length) {
      const best = SCORE[list[0].reason];
      const tied = list.length > 1 && SCORE[list[1].reason] === best;
      const contested = (claims.get(list[0].mapping_id) ?? []).filter(score => score >= best).length > 1;
      if (!tied && !contested) { status = 'PROPOSED'; proposed = list[0].mapping_id; proposedFor.set(proposed, machine.machine_number); }
    }
    machines.push({ ...base, status, current_source: null, current_looks_right: null, proposed_mapping_id: proposed, candidates: list });
  }
  machines.sort(byNumber);

  const wantedBy = new Map<string, string[]>();
  for (const machine of machines) {
    if (machine.status !== 'CHOOSE' && machine.status !== 'PROPOSED') continue;
    for (const candidate of machine.candidates)
      wantedBy.set(candidate.mapping_id, [...(wantedBy.get(candidate.mapping_id) ?? []), machine.machine_number]);
  }
  const sources: RoughSource[] = input.sources.map(source => {
    const owner = input.assigned.get(source.mapping_id);
    let outcome: RoughSourceOutcome; let numbers: string[] = [];
    if (owner && machineNumber.has(owner)) { outcome = 'IN_USE'; numbers = [machineNumber.get(owner)!]; }
    else if (!eligibleSource(source)) outcome = 'NOT_ELIGIBLE';
    else if (proposedFor.has(source.mapping_id)) { outcome = 'PROPOSED'; numbers = [proposedFor.get(source.mapping_id)!]; }
    else if (wantedBy.has(source.mapping_id)) { outcome = 'CANDIDATE'; numbers = wantedBy.get(source.mapping_id)!; }
    else outcome = 'NO_MACHINE';
    const other = outcome === 'NO_MACHINE'
      ? [...new Set(active.filter(m => m.department !== source.department).filter(m => {
          const reason = roughMatch(m.machine_number, source);
          return reason === 'ENDS_IN_NUMBER' || reason === 'NAME_HAS_NUMBER';
        }).map(m => m.department))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      : [];
    return { mapping_id: source.mapping_id, department: source.department, whiteboard_name: source.whiteboard_name,
      line_name: source.line_name, outcome, machine_numbers: numbers, other_departments: other };
  });
  sources.sort((a, b) => a.department.localeCompare(b.department, undefined, { numeric: true }) ||
    a.whiteboard_name.localeCompare(b.whiteboard_name, undefined, { numeric: true }) || a.mapping_id.localeCompare(b.mapping_id));
  return { machines, sources };
}
