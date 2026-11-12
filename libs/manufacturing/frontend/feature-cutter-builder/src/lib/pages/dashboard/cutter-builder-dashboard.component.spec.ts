import { TestBed } from '@angular/core/testing';
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

  it('offers the grinding link only to users who may edit Blade Tracking', () => {
    expect(create({ role: 'user', departmentCode: '45', permissions: ['trays:startGrinding'] }).canEditBladeTracking).toBe(true);
    TestBed.resetTestingModule();
    expect(create({ role: 'user', departmentCode: '45', permissions: ['cutter-builder:createBuild'] }).canEditBladeTracking).toBe(false);
    TestBed.resetTestingModule();
    expect(create({ role: 'user', departmentCode: '48', permissions: null }).canEditBladeTracking).toBe(false);
  });
});
