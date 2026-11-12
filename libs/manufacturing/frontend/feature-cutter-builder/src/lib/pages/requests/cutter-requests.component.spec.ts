import { ChangeDetectorRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { CutterBuilderApiService, CutterRequestRequirement, CutterRequestRow } from '@meshforge/manufacturing/frontend/data-access-cutter-builder';
import { frontendFeatureCutterBuilderRoutes } from '../../cutter-builder.routes';
import { CutterRequestsComponent } from './cutter-requests.component';

const requirement: CutterRequestRequirement = {
  summary_id: 'summary-ring', part_type_id: 'ring-id', required_blade_count: 19, enabled: true,
  summary: { id: 'summary-ring', number: '1010', revision: 'A', enabled: true, active: true },
  part_type: { id: 'ring-id', code: 'RING', enabled: true },
};
const row: CutterRequestRow = {
  id: 'request-1', summary_id: requirement.summary_id, summary_number: '1010', part_type_id: 'ring-id', part_type_code: 'RING',
  requested_quantity: 3, built_quantity: 1, remaining_quantity: 2, status: 'IN_PROGRESS', notes: 'Needed next shift',
  requested_by: 'lead-1', requested_by_name: 'Team Lead', requested_at: '2026-11-12T12:00:00Z', updated_at: '2026-11-12T12:00:00Z', completed_at: null,
  build_ids: ['build-1'], build_numbers: ['B-0001'],
};

describe('Cutter Requests shared page', () => {
  let component: CutterRequestsComponent | undefined;
  let api: Record<string, jest.Mock>;
  beforeEach(() => {
    api = {
      listCutterRequests: jest.fn(() => of([row])), getCutterRequestRequirements: jest.fn(() => of([requirement])),
      createCutterRequest: jest.fn(() => of(row)), updateCutterRequestStatus: jest.fn(() => of(row)),
    };
  });
  afterEach(() => { component?.ngOnDestroy(); component = undefined; jest.useRealTimers(); });
  function create(permissions: string[] | null = null): CutterRequestsComponent {
    const identity = { role: 'user', departmentCode: '132', permissions };
    TestBed.configureTestingModule({ providers: [
      { provide: CutterBuilderApiService, useValue: api },
      { provide: AuthSessionService, useValue: { currentUser: identity, authState$: new BehaviorSubject(identity) } },
      { provide: Router, useValue: { url: '/greenshed/cutter-requests' } },
      { provide: ChangeDetectorRef, useValue: { markForCheck: jest.fn() } },
    ] });
    component = TestBed.runInInjectionContext(() => new CutterRequestsComponent());
    return component;
  }
  function fillDraft(page: CutterRequestsComponent): void {
    page.requirements = [requirement];
    page.draft = { summary_id: requirement.summary_id, part_type_code: 'RING', quantity: 3, notes: '  Needed next shift  ' };
  }
  it('loads the open queue and valid Summary / Part Type choices independently', () => {
    const page = create(); page.ngOnInit();
    expect(api['listCutterRequests']).toHaveBeenCalledWith(false);
    expect(page.summaries).toEqual([{ id: 'summary-ring', label: '1010 rev A' }]);
    page.draft.summary_id = 'summary-ring';
    expect(page.partTypes).toEqual([{ code: 'RING', label: 'Ring' }]);
  });
  it('does not hide the queue when form choices are forbidden or unavailable', () => {
    api['getCutterRequestRequirements'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Missing lookup access' } })));
    const page = create(); page.ngOnInit();
    expect(page.rows).toEqual([row]); expect(page.lookupError).toContain('Missing lookup access'); expect(page.loadingChoices).toBe(false);
  });
  it('submits cutter quantities separately from blade requirements and clears only after saving', () => {
    const page = create(); fillDraft(page); page.create();
    expect(api['createCutterRequest']).toHaveBeenCalledWith({ summary_id: 'summary-ring', part_type_code: 'RING', quantity: 3, notes: 'Needed next shift' });
    expect(page.draft).toEqual({ summary_id: '', part_type_code: '', quantity: 1, notes: '' });
    expect(api['listCutterRequests']).toHaveBeenCalledWith(false);
  });
  it.each([0, -1, 0.5, 100, NaN])('rejects invalid cutter quantity %s without a request', quantity => {
    const page = create(); fillDraft(page); page.draft.quantity = quantity; page.create();
    expect(api['createCutterRequest']).not.toHaveBeenCalled(); expect(page.formError).toContain('whole number from 1 to 99');
  });
  it('rejects a Part Type not configured for the selected Summary', () => {
    const page = create(); fillDraft(page); page.draft.part_type_code = 'PINION'; page.create();
    expect(api['createCutterRequest']).not.toHaveBeenCalled(); expect(page.formError).toContain('Part Summary');
  });
  it('keeps a failed request draft for correction', () => {
    api['createCutterRequest'].mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { message: 'Summary disabled' } })));
    const page = create(); fillDraft(page); page.create();
    expect(page.draft.quantity).toBe(3); expect(page.draft.notes).toBe('  Needed next shift  '); expect(page.formError).toBe('Summary disabled'); expect(page.busy).toBe(false);
  });
  it('uses API build evidence instead of subtracting Remaining after a manual terminal transition', () => {
    const page = create(); page.rows = [{ ...row, status: 'COMPLETED', requested_quantity: 3, remaining_quantity: 0, built_quantity: 1 }];
    expect(page.builtTotal).toBe(1); expect(page.builds(page.rows[0])).toEqual([{ id: 'build-1', number: 'B-0001' }]);
  });
  it('shows legacy build-number links when a rolling API response has no build_ids', () => {
    const page = create();
    expect(page.builds({ ...row, build_ids: undefined, build_numbers: ['OLD-001'] })).toEqual([{ id: 'OLD-001', number: 'OLD-001' }]);
  });
  it('keeps build projections stable for each immutable queue response', () => {
    const page = create();
    expect(page.builds(row)).toBe(page.builds(row));
  });
  it('only offers Complete for Ready and keeps Cancel away from terminal requests', () => {
    const page = create(); page.askStatus(row, 'COMPLETED'); expect(page.confirmation).toBeNull();
    page.askStatus({ ...row, status: 'READY' }, 'COMPLETED'); expect(page.confirmation?.status).toBe('COMPLETED');
    page.confirmation = null; page.askStatus({ ...row, status: 'CANCELED' }, 'CANCELED'); expect(page.confirmation).toBeNull();
  });
  it('updates status only after confirmation and refreshes the same queue', () => {
    const page = create(); page.askStatus(row, 'CANCELED');
    expect(api['updateCutterRequestStatus']).not.toHaveBeenCalled(); page.applyStatus();
    expect(api['updateCutterRequestStatus']).toHaveBeenCalledWith('request-1', 'CANCELED'); expect(page.confirmation).toBeNull(); expect(page.message).toBe('Request canceled.');
  });
  it('honors read-only action grants even when mutation methods are invoked directly', () => {
    const page = create(['cutter-builder:listCutterRequests']); page.ngOnInit(); fillDraft(page); page.create();
    page.askStatus({ ...row, status: 'READY' }, 'COMPLETED'); page.applyStatus();
    expect(page.canCreate).toBe(false); expect(page.canUpdate).toBe(false); expect(api['getCutterRequestRequirements']).not.toHaveBeenCalled();
    expect(api['createCutterRequest']).not.toHaveBeenCalled(); expect(api['updateCutterRequestStatus']).not.toHaveBeenCalled();
  });
  it('does not fetch protected request records without the list grant', () => {
    const page = create([]); page.ngOnInit(); page.refresh();
    expect(api['listCutterRequests']).not.toHaveBeenCalled(); expect(page.canRead).toBe(false);
  });
  it('ignores an older queue response after a newer filter request completes', () => {
    const old = new Subject<CutterRequestRow[]>(); api['listCutterRequests'].mockReturnValueOnce(old).mockReturnValueOnce(of([{ ...row, id: 'new' }]));
    const page = create(); page.refresh(); page.includeCompleted = true; page.refresh(); old.next([row]);
    expect(page.rows[0].id).toBe('new'); expect(api['listCutterRequests']).toHaveBeenLastCalledWith(true);
  });
  it('preserves the Cutter Builder historical route without a department-only edit guard', () => {
    expect(frontendFeatureCutterBuilderRoutes.find(route => route.path === 'requests')?.component).toBe(CutterRequestsComponent);
    expect(frontendFeatureCutterBuilderRoutes.find(route => route.path === 'requests')?.canActivate).toBeUndefined();
  });
});

describe('Cutter Requests rendered queue stability', () => {
  let fixture: ComponentFixture<CutterRequestsComponent> | undefined;
  afterEach(() => { fixture?.destroy(); fixture = undefined; });

  it('preserves linked build DOM during repeated checks and refreshed request snapshots', () => {
    const identity = { role: 'admin', departmentCode: '45', permissions: null };
    TestBed.configureTestingModule({
      imports: [CutterRequestsComponent],
      providers: [
        provideRouter([]),
        { provide: AuthSessionService, useValue: { currentUser: identity, authState$: new BehaviorSubject(identity) } },
        { provide: CutterBuilderApiService, useValue: {
          listCutterRequests: jest.fn(() => of([{ ...row }])),
          getCutterRequestRequirements: jest.fn(() => of([requirement])),
        } },
      ],
    });
    fixture = TestBed.createComponent(CutterRequestsComponent);
    fixture.detectChanges();
    const table: HTMLTableElement = fixture.nativeElement.querySelector('table');
    const link: HTMLAnchorElement = table.querySelector('.request-builds a') as HTMLAnchorElement;
    expect(link.textContent).toBe('B-0001');
    expect(link.getAttribute('href')).toContain('/cutter-builder/lookup?build=B-0001');
    const observer = new MutationObserver(() => undefined);
    observer.observe(table, { childList: true, subtree: true });
    try {
      fixture.changeDetectorRef.markForCheck();
      fixture.detectChanges();
      fixture.componentInstance.refresh();
      fixture.detectChanges();
      expect(table.querySelector('.request-builds a')).toBe(link);
      expect(observer.takeRecords()).toHaveLength(0);
    } finally {
      observer.disconnect();
    }
  });
});

describe('Cutter Requests API contract', () => {
  let api: CutterBuilderApiService; let backend: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(CutterBuilderApiService); backend = TestBed.inject(HttpTestingController);
  });
  afterEach(() => backend.verify());
  it('uses the deployed request paths and includeCompleted query parameter', () => {
    api.listCutterRequests(true).subscribe();
    const list = backend.expectOne(request => request.url === '/api/v1/cutter-builder/requests' && request.params.get('includeCompleted') === 'true');
    expect(list.request.method).toBe('GET'); list.flush([]);
    api.createCutterRequest({ summary_id: 'summary-ring', part_type_code: 'RING', quantity: 2, notes: null }).subscribe();
    const create = backend.expectOne('/api/v1/cutter-builder/requests');
    expect(create.request.method).toBe('POST'); expect(create.request.body).toEqual({ summary_id: 'summary-ring', part_type_code: 'RING', quantity: 2, notes: null }); create.flush(row);
    api.updateCutterRequestStatus('request-1', 'CANCELED').subscribe();
    const patch = backend.expectOne('/api/v1/cutter-builder/requests/request-1/status');
    expect(patch.request.method).toBe('PATCH'); expect(patch.request.body).toEqual({ status: 'CANCELED' }); patch.flush(row);
  });
});
