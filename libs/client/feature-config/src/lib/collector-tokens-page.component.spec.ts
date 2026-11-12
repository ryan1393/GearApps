import { TestBed } from '@angular/core/testing';
import { CollectorTokensApi, ToastService } from '@meshforge/client/core';
import { of } from 'rxjs';

import { CollectorTokensPageComponent } from './collector-tokens-page.component';

interface Page {
  requestDockerConnect(): void;
  connectDocker(): void;
  confirmReconnect(): boolean;
}

describe('Collector tokens: Docker collector connection', () => {
  function setup(token: object | null) {
    const api = {
      list: jest.fn(() => of([])),
      dockerConnection: jest.fn(() => of({ available: true, token })),
      connectDocker: jest.fn(() => of({})),
    };
    TestBed.configureTestingModule({
      imports: [CollectorTokensPageComponent],
      providers: [
        { provide: CollectorTokensApi, useValue: api },
        { provide: ToastService, useValue: { success: jest.fn(), error: jest.fn(), info: jest.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(CollectorTokensPageComponent);
    fixture.detectChanges();
    return { page: fixture.componentInstance as unknown as Page, api };
  }

  it('connects straight away when the collector has no token yet', () => {
    const { page, api } = setup(null);
    page.requestDockerConnect();
    expect(page.confirmReconnect()).toBe(false);
    expect(api.connectDocker).toHaveBeenCalledTimes(1);
  });

  it('asks before reconnecting, because that revokes the live token', () => {
    const { page, api } = setup({ hint: 'abcd', created_at: '2026-11-12T00:00:00Z', last_used_at: null });
    page.requestDockerConnect();
    expect(page.confirmReconnect()).toBe(true);
    expect(api.connectDocker).not.toHaveBeenCalled();
    page.connectDocker();
    expect(page.confirmReconnect()).toBe(false);
    expect(api.connectDocker).toHaveBeenCalledTimes(1);
  });
});
