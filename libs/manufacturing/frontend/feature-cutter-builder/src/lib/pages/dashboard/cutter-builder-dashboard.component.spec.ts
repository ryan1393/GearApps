import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { CutterBuilderApiService } from '@meshforge/manufacturing/frontend/data-access-cutter-builder';
import { CutterBuilderDashboardComponent } from './cutter-builder-dashboard.component';

describe('Cutter Builder dashboard grinding hand-off', () => {
  function create(user: { role: string; departmentCode?: string; permissions?: string[] | null }) {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionService, useValue: { currentUser: user } },
        { provide: CutterBuilderApiService, useValue: { getDashboard: jest.fn(() => of(null)) } },
      ],
    });
    return TestBed.runInInjectionContext(() => new CutterBuilderDashboardComponent());
  }

  it('links a waiting tray to Blade Tracking Grinding instead of posting a start without a grinder', () => {
    const dashboard = create({ role: 'user', departmentCode: '45', permissions: null });
    const url = new URL(dashboard.grindingStationUrl('T 0042'));
    expect(url.port).toBe('4200');
    expect(url.pathname).toBe('/blades/operations');
    expect(url.searchParams.get('op')).toBe('grinding');
    expect(url.searchParams.get('tray')).toBe('T 0042');
  });

  it('keeps IDs and status on one line with the full value in a title, and copies an ID', async () => {
    const data = {
      counts: { builds_in_progress: 0, ready_to_run: 0, on_shelf: 0, under_teardown: 0, waiting_for_grinding: 1, ready_for_cutter_shelf: 0 },
      waiting_for_grinding: [{ tray_id: 't', tray_serial_number: 'TRAY-000123456', summary_number: '1.955FC', part_type_code: 'RING', blade_count: 26 }],
      ready_for_cutter: [],
      recent_builds: [{ build_number: 'CGRT076AAA-0012', cutter_body_serial_number: 'CGRT076AAA', summary_number: '1.955FC', status_code: 'RUNNING', built_at: '2026-11-01' }],
      recent_teardowns: [],
    };
    TestBed.configureTestingModule({
      imports: [CutterBuilderDashboardComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: { currentUser: { role: 'admin' } } },
        { provide: CutterBuilderApiService, useValue: { getDashboard: jest.fn(() => of(data)) } },
      ],
    });
    const fixture = TestBed.createComponent(CutterBuilderDashboardComponent);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    const tray = Array.from(host.querySelectorAll('.cell-text')).find((cell) => cell.textContent?.trim() === 'TRAY-000123456') as HTMLElement;
    expect(tray.getAttribute('title')).toBe('TRAY-000123456');
    const pill = host.querySelector('.status-pill') as HTMLElement;
    expect(pill.getAttribute('title')).toBe('RUNNING');
    expect(Array.from(host.querySelectorAll('thead .th-label')).map((label) => label.textContent)).toContain('Shelf');

    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
    (host.querySelector('[aria-label="Copy TRAY-000123456"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith('TRAY-000123456');
    expect(fixture.componentInstance.copiedValue).toBe('TRAY-000123456');
    expect(host.textContent).toContain('Copied TRAY-000123456');
    fixture.destroy();
  });

  it('gives Cancel Last Build its own icon instead of the Build Lookup magnifier', () => {
    TestBed.configureTestingModule({
      imports: [CutterBuilderDashboardComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: { currentUser: { role: 'admin' } } },
        { provide: CutterBuilderApiService, useValue: { getDashboard: jest.fn(() => of(null)) } },
      ],
    });
    const fixture = TestBed.createComponent(CutterBuilderDashboardComponent);
    fixture.detectChanges();
    const icon = (label: string) => (fixture.nativeElement.querySelector(`[aria-label="${label}"] .gear-glyph`) as HTMLElement).className;
    expect(icon('Cancel Last Build')).not.toContain('gear-glyph-search');
    expect(icon('Build Lookup')).toContain('gear-glyph-search');
    fixture.destroy();
  });

  it('offers the grinding link only to users who may edit Blade Tracking', () => {
    expect(create({ role: 'user', departmentCode: '45', permissions: ['trays:startGrinding'] }).canEditBladeTracking).toBe(true);
    TestBed.resetTestingModule();
    expect(create({ role: 'user', departmentCode: '45', permissions: ['cutter-builder:createBuild'] }).canEditBladeTracking).toBe(false);
    TestBed.resetTestingModule();
    expect(create({ role: 'user', departmentCode: '48', permissions: null }).canEditBladeTracking).toBe(false);
  });
});
