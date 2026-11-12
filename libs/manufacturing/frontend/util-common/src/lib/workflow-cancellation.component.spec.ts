import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { WorkflowCancellationComponent } from './workflow-cancellation.component';

const operation = {
  id: 'operation-1', identifier: 'BUILD-1', action: 'Build cutter', occurred_at: '2026-11-12T12:00:00Z',
  recorded_by: 'Operator', canceled_at: null, canceled_by: null, cancellation_reason: null,
  can_cancel: true, blocked_reason: null,
};

describe('Workflow cancellation confirmation', () => {
  let page: WorkflowCancellationComponent;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),{
      provide: ActivatedRoute, useValue: { snapshot: { data: {cancellationApp:'cutter-builder'}, queryParamMap:{get:()=>null} } },
    }]});
    page=TestBed.runInInjectionContext(()=>new WorkflowCancellationComponent());
    page.ngOnInit(); http=TestBed.inject(HttpTestingController);
    page.view={latest:{...operation},history:[{...operation}],message:null};
    page.reason=' Wrong cutter body ';
  });
  afterEach(()=>http.verify());

  it('requires explicit confirmation and submits the reviewed operation/reason only once', () => {
    page.cancel(); http.expectNone('/api/v1/workflow-cancellation/cutter-builder');
    expect(page.confirmationMessage).toContain('BUILD-1');
    expect(page.confirmationMessage).toContain('Wrong cutter body');
    page.reason='Changed after preview';
    page.confirmCancellation(); page.confirmCancellation();
    const request=http.expectOne('/api/v1/workflow-cancellation/cutter-builder');
    expect(request.request.body).toEqual({identifier:'BUILD-1',operation_id:'operation-1',reason:'Wrong cutter body'});
    request.flush({...operation,can_cancel:false,canceled_at:'2026-11-12T12:01:00Z'});
    expect(page.view?.latest?.can_cancel).toBe(false);
    expect(page.message).toContain('Canceled.');
  });

  it('keeps the transaction when the dialog is dismissed', () => {
    page.cancel(); page.pendingCancellation=null; page.confirmCancellation();
    http.expectNone('/api/v1/workflow-cancellation/cutter-builder');
    expect(page.view?.latest?.can_cancel).toBe(true);
    expect(page.reason).toBe(' Wrong cutter body ');
  });

  it('refuses confirmation when the loaded operation has changed', () => {
    page.cancel();
    if(page.view?.latest) page.view.latest.id='operation-2';
    page.confirmCancellation(); http.expectNone('/api/v1/workflow-cancellation/cutter-builder');
  });

  it('validates the reason before showing a confirmation', () => {
    for(const reason of ['', '   ', 'x'.repeat(1001)]) {
      page.reason=reason; page.cancel(); expect(page.pendingCancellation).toBeNull();
    }
    http.expectNone('/api/v1/workflow-cancellation/cutter-builder');
  });

  it('preserves a failed cancellation reason and exposes the API failure inline', () => {
    page.cancel(); page.confirmCancellation();
    http.expectOne('/api/v1/workflow-cancellation/cutter-builder').flush({message:'A later operation prevents cancellation.'},{status:409,statusText:'Conflict'});
    expect(page.error).toBe('A later operation prevents cancellation.');
    expect(page.reason).toBe(' Wrong cutter body ');
    expect(page.busy).toBe(false);
  });
});
