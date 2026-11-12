import type { MachineCount, DsfMappingSnapshot, DsfSource } from '@meshforge/shared/domain';
import { plantDepartmentCoverage, REFERENCE_DEPARTMENTS } from './plant-coverage';

const now = Date.parse('2026-11-11T16:00:00Z');
const machines = [{ machine_id: 'grinder', machine_number: 'G1', department: '45' },
  { machine_id: 'cutter', machine_number: '549', department: '132' }] as MachineCount[];
const source = (department: string, assigned_machine_id: string | null): DsfSource => ({
  mapping_id: department, department, assigned_machine_id, whiteboard_name: `DSF ${department}`, line_name: 'Line 1',
  mapping_active: true, whiteboard_active: true,
});
const board = (source_options: DsfSource[]): DsfMappingSnapshot => ({
  format: 'DSFMAPADMIN1', configured: true, interval_seconds: 60, source_options_status: 'READY',
  source_options_refreshed_at: '2026-11-11T15:59:50Z', source_options,
});

describe('plant-wide reference reconciliation', () => {
  it('retains all 15 reference departments, including Cuttergrind and departments absent from MeshForge', () => {
    const coverage = plantDepartmentCoverage(machines, null, now);
    expect(REFERENCE_DEPARTMENTS).toHaveLength(15);
    expect(coverage.map(row => row.code)).toEqual(REFERENCE_DEPARTMENTS);
    expect(coverage.find(row => row.code === '45')?.registered).toBe(1);
    expect(coverage.find(row => row.code === '600')).toMatchObject({ registered: 0, sourceMappings: null, unlinkedActiveSources: null });
  });

  it('discovers additional departments instead of limiting plant scope to the screenshot or 55-record catalog', () => {
    const coverage = plantDepartmentCoverage(machines, board([source('181', null), source('777', null), source('45', 'grinder')]), now);
    expect(coverage.find(row => row.code === '777')).toMatchObject({ inReference: false, registered: 0, sourceMappings: 1, unlinkedActiveSources: 1 });
    expect(coverage.find(row => row.code === '181')).toMatchObject({ registered: 0, sourceMappings: 1, unlinkedActiveSources: 1 });
    expect(coverage.find(row => row.code === '45')?.unlinkedActiveSources).toBe(0);
  });

  it('withholds source totals when the DSF source catalog expires, while preserving department visibility', () => {
    const coverage = plantDepartmentCoverage(machines, board([source('777', null)]), now + 200000);
    expect(coverage.find(row => row.code === '777')).toMatchObject({ sourceMappings: null, unlinkedActiveSources: null });
  });
});
