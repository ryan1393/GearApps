import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { FrontendFeatureAdminUsersComponent } from './frontend-feature-admin-users.component';
import { adminTabRedirect } from '../lib.routes';
import { ADMIN_TABS } from '../shared/admin-tabs';

@Component({ standalone: true, template: 'tab' })
class StubTabComponent {}

/** The Admin page with every tab route stubbed, mounted at /admin as in the apps. */
function configure() {
  TestBed.configureTestingModule({
    providers: [provideRouter([{
      path: 'admin',
      component: FrontendFeatureAdminUsersComponent,
      children: [
        { path: '', pathMatch: 'full', canActivate: [adminTabRedirect], children: [] },
        ...ADMIN_TABS.map((tab) => ({ path: tab, component: StubTabComponent })),
        { path: '**', redirectTo: 'users' },
      ],
    }])],
  });
}

describe('Admin page shell', () => {
  beforeEach(configure);

  it('opens Users at /admin', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin');
    expect(TestBed.inject(Router).url).toBe('/admin/users');
  });

  it.each(['gearsets', 'lapping-machines', 'scanners', 'access', 'cutter-bodies'])('turns the old /admin?tab=%s link into /admin/%s', async (tab) => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/admin?tab=${tab}`);
    expect(TestBed.inject(Router).url).toBe(`/admin/${tab}`);
  });

  it('keeps other query parameters and ignores an unknown tab', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin?tab=nonsense&focus=1');
    expect(TestBed.inject(Router).url).toBe('/admin/users?focus=1');
    await harness.navigateByUrl('/admin/not-a-tab');
    expect(TestBed.inject(Router).url).toBe('/admin/users');
  });

  it('marks the open tab and navigates from the section buttons and the mobile list', async () => {
    const harness = await RouterTestingHarness.create();
    const shell = await harness.navigateByUrl('/admin/trays', FrontendFeatureAdminUsersComponent);
    expect(shell.activeTab).toBe('trays');
    const current = harness.routeNativeElement?.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('Trays');

    const locations = Array.from(harness.routeNativeElement?.querySelectorAll('.gear-admin-tabs button') ?? [])
      .find((button) => button.textContent === 'Locations') as HTMLButtonElement;
    locations.click();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/admin/locations');
    expect(shell.activeTab).toBe('locations');

    shell.openTabByName('coater-rpa');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/admin/coater-rpa');
    shell.openTabByName('not-a-tab');
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/admin/coater-rpa');
  });

  it('applies the Roll Master page layout only on that tab', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/roll-masters');
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('section.gear-admin-page')?.classList.contains('gear-roll-master-page')).toBe(true);
    await harness.navigateByUrl('/admin/parts');
    harness.detectChanges();
    expect(harness.routeNativeElement?.querySelector('section.gear-admin-page')?.classList.contains('gear-roll-master-page')).toBe(false);
  });
});
