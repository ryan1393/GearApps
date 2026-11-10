import { LappingSummaryRow } from '@gearapps/shared/domain';
import { fieldValue, findByName, groupByForm, isOn, summaryPlacement } from './macro-map';

const row = (
  number: number,
  name: string,
  value: number,
  used_form = 'coast',
): LappingSummaryRow => ({
  id: String(number),
  number,
  name,
  value,
  used_form,
  machine_cycle_id: '',
  macro_id: '',
  status: 1,
  type: 'real',
  tab_index: 1,
  l60_table: '',
  extra: null,
});

describe('macro-map', () => {
  it('resolves fields by macro number and by name', () => {
    const rows = [
      row(10032, 'consec', 7, 'general_data'),
      row(0, 'coast_so_h', 1.5),
      row(1, 'coast_heel_h', 2.5),
    ];
    expect(fieldValue(rows, { label: '', macro: 10032 })).toBe(7);
    expect(fieldValue(rows, { label: '', name: 'so_h' })).toBe(1.5);
    expect(fieldValue(rows, { label: '', name: 'heel_h' })).toBe(2.5);
    expect(fieldValue(rows, { label: '', name: 'missing' })).toBeNull();
  });

  it('prefers exact/suffix matches over substring matches', () => {
    const rows = [row(1, 'coast_passes', 3), row(2, 'coast_pass_active', -1)];
    expect(findByName(rows, 'passes')?.value).toBe(3);
    expect(findByName(rows, 'pass_active')?.value).toBe(-1);
  });

  it('treats Fanuc -1 and 1 as ON', () => {
    expect(isOn(-1)).toBe(true);
    expect(isOn(1)).toBe(true);
    expect(isOn(0)).toBe(false);
    expect(isOn(null)).toBe(false);
  });

  it('groups rows by form', () => {
    const g = groupByForm([
      row(1, 'a', 1, 'mesh'),
      row(2, 'b', 2, 'mesh'),
      row(3, 'c', 3, 'drive'),
    ]);
    expect(g.get('mesh')?.length).toBe(2);
    expect(g.get('drive')?.length).toBe(1);
  });
});

describe('summaryPlacement', () => {
  it('names the summary field that reads a numbered macro', () => {
    expect(summaryPlacement({ number: 10203, name: 'runout', used_form: 'general_data' })).toBe(
      'General data · Runout check · Enabled',
    );
    expect(summaryPlacement({ number: 10028, name: 'x', used_form: 'gear_data' })).toBe(
      'Gearset data · Pinion diameter',
    );
  });

  it('matches path macros by name suffix', () => {
    expect(summaryPlacement({ number: 1, name: 'coast_heel_rpm', used_form: 'coast' })).toBe(
      'Path · Coast · Heel · RPM',
    );
    expect(summaryPlacement({ number: 2, name: 'drive_pass_active', used_form: 'drive' })).toBe(
      'Path · Drive · Pass active',
    );
  });

  it('returns null for macros no summary field reads', () => {
    expect(
      summaryPlacement({ number: 99999, name: 'spare', used_form: 'general_data' }),
    ).toBeNull();
    expect(summaryPlacement({ number: 1, name: 'spare', used_form: null })).toBeNull();
  });
});
