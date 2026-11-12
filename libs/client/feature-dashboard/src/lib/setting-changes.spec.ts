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
    return { cyclesApi, panel, rows: () => [...panel.querySelectorAll('tbody tr')].map((r) => r.textContent?.replace(/\s+/g, ' ').trim()) };
  }

  it('asks for the last 8 hours and lists each flagged cycle with what changed', () => {
    const { cyclesApi, rows, panel } = render({
      hours: 8,
      total: 1,
      items: [{
        machine_cycle_id: 'c1', machine_id: 'm1', machine_number: '01-094-901', gearset_id: 'g1', gearset_number: '373',
        serial_number: 'SN-A5', consec: 5, timestamp: '2026-11-11T21:04:00Z',
        changes: [
          { number: 10401, name: 'Lapping speed', unit: 'rpm', previous_value: 1200, value: 1250 },
          { number: 10402, name: 'Torque', unit: null, previous_value: 50, value: 55.5 },
        ],
      }],
    });
    expect(cyclesApi.settingChanges).toHaveBeenCalledWith(8);
    expect(panel.querySelector('h2')?.textContent).toContain('last 8 hours');
    const [row] = rows();
    expect(row).toContain('01-094-901');
    expect(row).toContain('SN-A5');
    const changes = [...panel.querySelectorAll('.setting-change-list li')].map((li) =>
      [...li.children].map((part) => part.textContent?.replace(/\s+/g, ' ').trim()).join(' '),
    );
    expect(changes).toEqual(['#10401 Lapping speed 1,200 → 1,250 rpm', '#10402 Torque 50 → 55.5']);
    const link = panel.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/lapping-summaries?machine=m1&gearset=g1');
  });

  it('says so when only the consec counter moved', () => {
    const { rows } = render({ hours: 8, total: 0, items: [] });
    expect(rows()).toEqual(['No settings changed in the last 8 hours: only the consec counter moved.']);
  });
});
