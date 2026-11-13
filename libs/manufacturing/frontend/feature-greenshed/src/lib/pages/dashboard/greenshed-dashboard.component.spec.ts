import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { GreenshedApiService, GreenshedDashboard } from '@meshforge/manufacturing/frontend/data-access-greenshed';
import { GreenshedDashboardComponent } from './greenshed-dashboard.component';

describe('Greenshed dashboard refresh', () => {
  it('never lets a slow earlier answer replace newer counts', () => {
    const first = new Subject<GreenshedDashboard>(), second = new Subject<GreenshedDashboard>();
    const getDashboard = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    TestBed.configureTestingModule({ providers: [
      { provide: GreenshedApiService, useValue: { getDashboard } },
      { provide: AuthSessionService, useValue: { currentUser: null } },
    ] });
    const dashboard = TestBed.runInInjectionContext(() => new GreenshedDashboardComponent());
    dashboard.refresh(); dashboard.refresh();
    second.next({ counts: { running: 2 } } as GreenshedDashboard);
    first.next({ counts: { running: 1 } } as GreenshedDashboard);
    first.error(new Error('late failure'));
    expect(dashboard.data?.counts.running).toBe(2);
    expect(dashboard.loading).toBe(false);
    expect(dashboard.error).toBe('');
  });
});
