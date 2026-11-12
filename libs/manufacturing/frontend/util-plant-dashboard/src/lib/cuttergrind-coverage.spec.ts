import type { MachineCount, DsfMappingSnapshot, DsfSource } from '@meshforge/shared/domain';
import { cuttergrindCoverage, departmentLabel } from './cuttergrind-coverage';

const now = Date.parse('2026-11-11T16:00:00Z');
const source = (mapping_id: string, assigned_machine_id: string | null, department = '45'): DsfSource => ({
  mapping_id, assigned_machine_id, department, whiteboard_name: `CutGrind ${mapping_id}`,
  line_name: 'Cuttergrind', mapping_active: true, whiteboard_active: true,
});
const board = (source_options: DsfSource[]): DsfMappingSnapshot => ({
  format: 'DSFMAPADMIN1', configured: true, interval_seconds: 60, source_options_status: 'READY',
  source_options_refreshed_at: '2026-11-11T15:59:50Z', source_options,
});
const machines = [{ machine_id: 'grinder', machine_number: '01-114-024', department: '45', status: 'NOT_CONFIGURED' },
  { machine_id: 'cutter', machine_number: '549', department: '132' }] as MachineCount[];

describe('Cuttergrind inventory coverage', () => {
  it('surfaces CutGrind DSF sources even when they are missing from the registered catalog', () => {
    const coverage = cuttergrindCoverage(machines, board([source('1', 'grinder'), source('3 1-24-79', null), source('cutter', 'cutter', '132')]), now);
    expect(coverage.fresh).toBe(true);
    expect(coverage.registered.map(machine => machine.machine_number)).toEqual(['01-114-024']);
    expect(coverage.sources).toHaveLength(2);
    expect(coverage.unlinked.map(row => row.whiteboard_name)).toEqual(['CutGrind 3 1-24-79']);
    expect(coverage.unlinked[0].machine).toBeNull();
    expect(departmentLabel('45')).toContain('Cuttergrind');
  });

  it('does not treat missing, stale, or disabled discovery as verified coverage', () => {
    expect(cuttergrindCoverage(machines, null, now).fresh).toBe(false);
    expect(cuttergrindCoverage(machines, board([]), now + 200000).fresh).toBe(false);
    expect(cuttergrindCoverage(machines, { ...board([]), configured: false }, now).fresh).toBe(false);
    expect(cuttergrindCoverage(machines, { ...board([]), source_options_status: 'WAITING' }, now).fresh).toBe(false);
  });

  it('retains inactive and multiple source mappings for review without counting them as unique physical machines', () => {
    const sources = [source('1', 'grinder'), source('2', 'grinder'),
      { ...source('3', null), whiteboard_active: false }, source('4', 'unknown-machine')];
    const coverage = cuttergrindCoverage(machines, board(sources), now);
    expect(coverage.registered).toHaveLength(1);
    expect(coverage.sources).toHaveLength(4);
    expect(coverage.unlinked.map(row => row.mapping_id)).toEqual(['4']);
  });
});
