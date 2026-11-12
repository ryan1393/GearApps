import { DsfCountRow, DsfCountsBoard, RunningMachineRow } from '@meshforge/manufacturing/frontend/data-access-greenshed';

/**
 * The rules behind the Running Machines screens: the table at /greenshed/machines and the touch
 * board at /greenshed/machines-board both use these, so the two never disagree.
 */

/** Machines by cell (machines with no cell last), then by machine number. */
export function sortRunningMachines(machines: readonly RunningMachineRow[]): RunningMachineRow[] {
  return [...machines].sort((a, b) => {
    if (a.cell == null && b.cell != null) return 1;
    if (a.cell != null && b.cell == null) return -1;
    if (a.cell != null && b.cell != null && a.cell !== b.cell) return a.cell - b.cell;
    return a.machine_number.localeCompare(b.machine_number, undefined, { numeric: true });
  });
}

/** A failed or held check is not a completed quality check, however recently it was recorded. */
export function checkNeedsAttention(machine: RunningMachineRow): boolean {
  return machine.last_check_code !== 'CS' && ['FAIL', 'HOLD'].includes(String(machine.last_check_result ?? '').toUpperCase());
}

/** The last check's kind as the table shows it: Setup, Frequency, CMM or its stored name. */
export function lastCheckKind(machine: RunningMachineRow): string {
  switch (machine.last_check_code) {
    case 'CS': return 'Setup';
    case 'FC': return 'Frequency';
    case 'CMM': return 'CMM';
    default: return machine.last_check_name ?? '';
  }
}

export type MachineCheckTone = 'success' | 'warning' | 'danger';

/**
 * The colour the table gives a running cutter's last check, as a word the board shows on its badge:
 *   red    (danger)  a check is due, or the last check was FAIL / HOLD
 *   yellow (warning) only the setup is recorded, no quality check yet
 *   green  (success) the last quality check passed
 * Red wins over yellow, as in the table. Null for a machine with no cutter.
 */
export function machineCheckStatus(machine: RunningMachineRow): { tone: MachineCheckTone; label: string } | null {
  if (!machine.has_cutter) return null;
  if (checkNeedsAttention(machine)) return { tone: 'danger', label: String(machine.last_check_result).toUpperCase() };
  if (machine.check_due) return { tone: 'danger', label: 'CHECK DUE' };
  if (machine.last_check_code === 'CS') return { tone: 'warning', label: 'SETUP — NO CHECK YET' };
  return { tone: 'success', label: String(machine.last_check_result ?? '').toUpperCase() || 'PASS' };
}

export interface DsfCountCell {
  value: number | null;
  label: string;
  /** Where the number comes from and when it was counted. The table shows it on hover; the board as text. */
  title: string;
  warning: boolean;
}

const DSF_STATUS_LABELS: Record<string, string> = {
  NOT_CONFIGURED: 'Not enabled', WAITING: 'Waiting', MAPPING_REVIEW: 'Mapping review', SHIFT_REVIEW: 'Shift review',
  DATA_REVIEW: 'Data review', INACTIVE: 'Inactive', UNAVAILABLE: 'Unavailable',
};

/** One machine's DSF (Digital Shop Floor) count for the current shift, and whether it can be trusted. */
export function dsfCountCell(row: DsfCountRow | undefined, board: DsfCountsBoard | null, transportFailed: boolean, now = Date.now()): DsfCountCell {
  if (!row) {
    const label = transportFailed ? 'Unavailable' : board?.status === 'UNAVAILABLE' ? 'Unavailable' :
      board?.status === 'WAITING' ? 'Waiting' : 'Not mapped';
    return { value: null, label, title: 'No DSF source is mapped to this machine.', warning: transportFailed };
  }
  const expired = !!row.shift_end && now >= Date.parse(row.shift_end);
  const stale = transportFailed || row.status === 'STALE' ||
    (!!row.refreshed_at && now - Date.parse(row.refreshed_at) > ((board?.interval_seconds || 300) * 2 + 30) * 1000);
  const usable = !expired && row.count != null && ['OK', 'STALE', 'UNAVAILABLE'].includes(row.status);
  const label = expired && ['OK', 'STALE', 'UNAVAILABLE'].includes(row.status) ? 'New shift pending' :
    usable && stale ? 'Stale' : usable ? 'Shift ' + row.shift_number : (DSF_STATUS_LABELS[row.status] || 'Unavailable');
  const at = row.as_of ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Indiana/Indianapolis',
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(row.as_of)) + ' ET' : 'No verified count';
  return { value: usable ? row.count : null, label,
    title: 'DSF machine total for the current shift. ' + (row.shift_date || '') + ' | Counted through ' + at + ' | ' + row.note,
    warning: stale || ['MAPPING_REVIEW', 'SHIFT_REVIEW', 'DATA_REVIEW', 'UNAVAILABLE'].includes(row.status) };
}

/** What tapping a machine offers: the actions for a running cutter, setup for an empty active machine. */
export type MachineAction = 'frequency' | 'cmm' | 'changeover' | 'death-certificate' | 'setup' | 'lookup';

/** Where each machine action goes. The machine and run travel along so the next page can refuse a changed run. */
export function machineActionRoute(action: MachineAction, machine: RunningMachineRow): { commands: string[]; queryParams: Record<string, string | null | undefined> } {
  const run = { machine: machine.machine_number, run: machine.run_id, origin: 'running-machines' };
  switch (action) {
    case 'frequency': return { commands: ['/greenshed/check'], queryParams: { build: machine.build_number, ...run, type: 'FC' } };
    case 'cmm': return { commands: ['/greenshed/check'], queryParams: { build: machine.build_number, ...run, type: 'CMM' } };
    case 'changeover': return { commands: ['/greenshed/pull'], queryParams: { build: machine.build_number, reason: 'CHANGEOVER', ...run } };
    case 'death-certificate': return { commands: ['/greenshed/pull'], queryParams: { build: machine.build_number, ...run } };
    case 'setup': return { commands: ['/greenshed/setup'], queryParams: { machine: machine.machine_number, origin: 'running-machines' } };
    case 'lookup': return { commands: ['/greenshed/lookup'], queryParams: { build: machine.build_number } };
  }
}
