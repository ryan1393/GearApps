import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { LapperAccess, MachineCyclesApi, MachinesApi } from '@meshforge/client/core';
import { SettingChanges } from '@meshforge/shared/domain';
import { CellsOverviewPageComponent } from './cells-overview-page.component';

describe('Lapper Dashboard setting changes', () => {
  function render(changes: SettingChanges) {
    const cyclesApi = {
      production: jest.fn(() => of({ cycles_24h: 0, machines_reporting_24h: 0, missing_serial_24h: 0, last_cycle_at: null, machines: [] })),
      settingChanges: jest.fn(() => of(changes)),
    };
    TestBed.configureTestingModule({
      imports: [CellsOverviewPageComponent],
      providers: [
        provideRouter([]),
        { provide: MachinesApi, useValue: { list: () => of([]) } },
        { provide: MachineCyclesApi, useValue: cyclesApi },
        { provide: LapperAccess, useValue: { canEditSetup: () => false } },
      ],
    });
    const fixture = TestBed.createComponent(CellsOverviewPageComponent);
    fixture.detectChanges();
    const panel = (fixture.nativeElement as HTMLElement).querySelector('[data-testid=setting-changes]') as HTMLElement;
    return { cyclesApi, panel, fixture, rows: () => [...panel.querySelectorAll('tbody tr')].map((r) => r.textContent?.replace(/\s+/g, ' ').trim()) };
  }

  const flagged = (changes: SettingChanges['items'][number]['changes']): SettingChanges => ({
    hours: 8,
    total: 1,
    items: [{
      machine_cycle_id: 'c1', machine_id: 'm1', machine_number: '01-094-901', gearset_id: 'g1', gearset_number: '373',
      serial_number: 'SN-A5', consec: 5, timestamp: '2026-11-11T21:04:00Z', changes,
    }],
  });
  const change = (number: number, name: string, previous_value: number, value: number, unit: string | null = null) =>
    ({ number, name, unit, previous_value, value });
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('shows each flagged cycle on one line: how many values changed, with the names on hover', () => {
    const { cyclesApi, panel } = render(flagged([
      change(10499, 'drive_so_v_0', 0.013, 0.009), change(10500, 'drive_so_v_1', 0.013, 0.009),
      change(10506, 'drive_toe_v_0', 0.033, 0.029), change(10507, 'drive_toe_v_1', 0.033, 0.029),
      change(10513, 'drive_heel_v_0', -0.027, -0.031),
    ]));
    expect(cyclesApi.settingChanges).toHaveBeenCalledWith(8);
    expect(panel.querySelector('h2')?.textContent).toContain('last 8 hours');
    const row = panel.querySelector('tbody tr') as HTMLElement;
    expect(text(row)).toContain('01-094-901');
    expect(text(row.querySelector('gear-status-badge'))).toBe('5 changes');
    expect(row.querySelector('.setting-change-summary')?.getAttribute('title')).toBe('drive_so_v_0, drive_so_v_1, drive_toe_v_0, drive_toe_v_1, drive_heel_v_0');
    expect(panel.querySelector('.setting-change-grid')).toBeNull(); // details closed
    expect(panel.querySelector('a')?.getAttribute('href')).toBe('/lapping-summaries?machine=m1&gearset=g1');
  });

  it('opens and closes the details of one cycle, with each value before, after and the difference', () => {
    const { panel, fixture } = render(flagged([change(10401, 'Speed', 1200, 1250, 'rpm'), change(10513, 'drive_heel_v_0', -0.027, -0.031)]));
    const button = [...panel.querySelectorAll('button')].find((b) => text(b) === 'Show details') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    fixture.detectChanges();
    expect(text(button)).toBe('Hide details');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const items = [...panel.querySelectorAll('.setting-change-grid li')].map((li) =>
      [...li.children].map((part) => text(part)).join(' '),
    );
    expect(items).toEqual(['#10401 Speed 1,200 → 1,250 rpm +50', '#10513 drive_heel_v_0 -0.027 → -0.031 -0.004']);
    button.click();
    fixture.detectChanges();
    expect(panel.querySelector('.setting-change-grid')).toBeNull();
  });

  it('says one change, not one changes', () => {
    const { panel } = render(flagged([change(10401, 'Speed', 1200, 1250)]));
    expect(text(panel.querySelector('tbody gear-status-badge'))).toBe('1 change');
  });

  it('says so when no value sent to Argonaut changed', () => {
    const { rows } = render({ hours: 8, total: 0, items: [] });
    expect(rows()).toEqual(['No settings changed in the last 8 hours: no value sent to Argonaut changed.']);
  });
});
