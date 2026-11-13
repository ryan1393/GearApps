import { frontendFeatureGreenshedRoutes } from './greenshed.routes';

describe('Greenshed cutter request route', () => {
  it('loads the same request page without a department-only edit guard', async () => {
    const route = frontendFeatureGreenshedRoutes.find(route => route.path === 'cutter-requests');
    expect(route).toBeDefined();
    expect(route?.canActivate).toBeUndefined();
    const load = route?.loadComponent as (() => Promise<unknown>) | undefined;
    const { CutterRequestsComponent } = await import('@meshforge/manufacturing/frontend/feature-cutter-builder');
    expect(await load?.()).toBe(CutterRequestsComponent);
  });
});
