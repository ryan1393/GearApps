import type { DsfMappingSnapshot, MachineCount } from '@meshforge/shared/domain';

export function departmentLabel(code: string): string {
  return code === '45' ? 'Cuttergrind · Department 45' : `Department ${code}`;
}

export function sourceCatalogFresh(snapshot: DsfMappingSnapshot | null, now: number): boolean {
  const refreshed = Date.parse(snapshot?.source_options_refreshed_at ?? '');
  const interval = snapshot?.interval_seconds ?? 0;
  return snapshot?.configured === true && snapshot.source_options_status === 'READY' &&
    interval >= 30 && interval <= 3600 && Number.isFinite(refreshed) &&
    refreshed <= now + 10000 && now - refreshed <= (interval * 2 + 30) * 1000;
}

// Source mappings are operations, not a proven inventory of unique physical grinders.
// Do not merge sources by a similar name or fabricate local machine IDs/counts for them.
export function cuttergrindCoverage(machines: MachineCount[], snapshot: DsfMappingSnapshot | null, now: number) {
  const registered = machines.filter(machine => machine.department === '45');
  const byId = new Map(registered.map(machine => [machine.machine_id, machine]));
  const fresh = sourceCatalogFresh(snapshot, now);
  const sources = (snapshot?.source_options ?? []).filter(source => source.department === '45')
    .map(source => ({ ...source, machine: byId.get(source.assigned_machine_id ?? '') ?? null }))
    .sort((a, b) => a.whiteboard_name.localeCompare(b.whiteboard_name, undefined, { numeric: true }));
  const unlinked = sources.filter(source => source.mapping_active && source.whiteboard_active && !source.machine);
  return { registered, sources, unlinked, fresh };
}
