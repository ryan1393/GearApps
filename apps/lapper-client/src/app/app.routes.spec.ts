import { TestBed } from '@angular/core/testing';
import { provideRouter, Route, Router, UrlTree } from '@angular/router';
import { appRoutes } from './app.routes';

describe('Lapper master data routes', () => {
  const children = appRoutes.find((route) => route.canActivateChild)?.children ?? [];
  const redirectFor = (path: string): string => {
    const route = children.find((child: Route) => child.path === path);
    const redirect = route?.redirectTo;
    if (typeof redirect !== 'function') throw new Error(`${path} is not an Admin redirect`);
    const tree = TestBed.runInInjectionContext(() => redirect({} as never)) as UrlTree;
    return TestBed.inject(Router).serializeUrl(tree);
  };

  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it.each([
    ['machines', '/admin?tab=lapping-machines'],
    ['machine', '/admin?tab=lapping-machines'],
    ['parts', '/admin?tab=parts'],
    ['part', '/admin?tab=parts'],
    ['gearsets', '/admin?tab=gearsets'],
    ['part-summaries', '/admin?tab=part-summaries'],
    ['part-summary', '/admin?tab=part-summaries'],
  ])('sends the old /%s page to %s', (path, target) => {
    expect(redirectFor(path)).toBe(target);
  });

  it('no longer loads separate Lapper master-data pages', () => {
    for (const child of children) expect(child.loadChildren?.toString() ?? '').not.toMatch(/feature-(parts|machines)/);
  });
});
