import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { PlantDashboardDataService } from '@meshforge/manufacturing/frontend/data-access-plant-dashboard';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import type { ProductionSnapshot } from '@meshforge/shared/domain';
import { BehaviorSubject, of } from 'rxjs';

import { DashboardComponent } from './dashboard.component';

const snapshot = {
  format: 'DSFCOUNT1', configured: true, interval_seconds: 60, last_success_at: null, served_at: new Date().toISOString(),
  rows: [{ machine_id: 'm1', machine_number: '549', department: '132', status: 'WAITING', count: null, shift_number: null,
    shift_date: null, shift_start: null, shift_end: null, as_of: null, refreshed_at: null, note: '' }],
} as unknown as ProductionSnapshot;

describe('Plant dashboard', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navigate: jest.Mock;
  const data = {
    board: signal<ProductionSnapshot | null>(snapshot), error: signal(''), loading: signal(false),
    stale: signal(false), updatedAt: signal<number | null>(Date.now() - 12_000),
    mappingBoard: signal(null), mappingError: signal(''), isAdmin: false, refresh: jest.fn(),
  };

  function render(query: Record<string, string> = {}) {
    params = new BehaviorSubject(convertToParamMap(query));
    navigate = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: AuthSessionService, useValue: { logout: jest.fn(), currentUser: null, authState$: of(null) } },
        { provide: ActivatedRoute, useValue: { queryParamMap: params } },
        { provide: Router, useValue: { navigate, navigateByUrl: jest.fn() } },
      ],
    });
    TestBed.overrideComponent(DashboardComponent, { set: { providers: [{ provide: PlantDashboardDataService, useValue: data }] } });
    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    data.stale.set(false); data.error.set(''); data.board.set(snapshot);
    TestBed.resetTestingModule();
  });

  it('puts the KPIs and machine floor first and moves coverage checks to a Data quality tab', () => {
    const fixture = render();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Machine floor');
    expect(text).toContain('Updated 12 s ago');
    expect(text).not.toContain('Plant department coverage');
    expect(text).not.toContain('Cuttergrind machine coverage');
    fixture.componentInstance.view.set('quality');
    fixture.detectChanges();
    const quality = fixture.nativeElement.textContent as string;
    expect(quality).toContain('Plant department coverage');
    expect(quality).toContain('Cuttergrind and Departments 121, 131, 132, 152, 181, 191, 200, 240, 310, 341, 350, 400, 541, and 600');
    expect(quality).toContain('Missing counts are not zero production.');
    expect(quality).not.toContain('Machine floor');
  });

  it('keeps the last snapshot on screen and says it may be stale', () => {
    data.stale.set(true);
    data.error.set('Machine data is unavailable. Retrying automatically.');
    const fixture = render();
    // A stale-data warning is announced politely (danaAlert gives warnings role="status").
    const alert = [...fixture.nativeElement.querySelectorAll('[danaAlert]')].find((el: Element) =>
      /Data may be stale/.test(el.textContent ?? '')) as HTMLElement;
    expect(alert.getAttribute('role')).toBe('status');
    expect(alert.textContent).toMatch(/Data may be stale — last updated \d{1,2}:\d{2}:\d{2} [AP]M\./);
    expect(fixture.nativeElement.textContent).toContain('Machine 549');
  });

  it('opens as a wall display with ?kiosk=1, without the page chrome', () => {
    const fixture = render({ kiosk: '1' });
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('.dana-wall')).not.toBeNull();
    expect(page.querySelector('.plant-app-header')).toBeNull();
    expect(page.querySelector('.plant-filters')).toBeNull();
    expect(page.querySelectorAll('.dana-wall-kpi')).toHaveLength(4);
    expect(page.textContent).toContain('549');
  });

  it('toggles the wall display and remembers it in the address', () => {
    const fixture = render();
    fixture.componentInstance.setKiosk(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dana-wall')).not.toBeNull();
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { kiosk: 1 }, replaceUrl: true }));
    fixture.componentInstance.setKiosk(false);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { kiosk: null } }));
  });
});
