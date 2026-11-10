import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ServerSetting, ServerSettingsBoard, ServerSettingsComponent } from './server-settings.component';

const API = '/api/v1/admin/environment-settings';

const setting = (key: string, extra: Partial<ServerSetting> = {}): ServerSetting => ({
  key, label: key, help: null, type: 'text', options: null, secret: false, editable: true, locked_reason: null,
  value: '', is_set: false, source: 'ENVIRONMENT', environment_value: '', environment_is_set: false,
  pending: false, unreadable: false, updated_at: null, ...extra,
});

const board = (extra: Partial<ServerSettingsBoard> = {}): ServerSettingsBoard => ({
  format: 'GEARENVSETTINGS1', available: true, can_restart: false, restart_required: false,
  groups: [
    { id: 'lapping', title: 'Lapping and scanners', description: '', settings: [
      setting('SCANNER_TIMEOUT_MS', { type: 'number', value: '4000', is_set: true, environment_value: '4000' }),
      setting('SCANNER_FTP_PASSWORD', { secret: true, value: null, environment_value: null, is_set: true }),
      setting('LAPPER_TIME_ZONE', { value: 'America/Chicago', is_set: true, source: 'ADMIN', environment_value: 'America/Indianapolis' }),
    ] },
    { id: 'database', title: 'Database', description: '', settings: [
      setting('DATABASE_HOST', { editable: false, locked_reason: 'Change it in the server environment (.env).', value: 'db', is_set: true }),
    ] },
  ],
  ...extra,
});

describe('ServerSettingsComponent', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ServerSettingsComponent>;
  let component: ServerSettingsComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ServerSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne(API).flush(board());
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const find = (key: string) => component.board?.groups.flatMap((group) => group.settings).find((item) => item.key === key) as ServerSetting;

  it('shows every setting, with locked ones disabled and secrets never filled in', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.server-settings-row').length).toBe(4);
    expect((element.querySelector('#setting-DATABASE_HOST') as HTMLInputElement).disabled).toBe(true);
    expect(element.textContent).toContain('Change it in the server environment (.env).');
    expect(element.querySelector('input[type="password"]')).toBeNull();
    expect(component.changedCount).toBe(0);
  });

  it('sends only what changed: an edit, a replaced secret, and a return to the server value', () => {
    component.draft['SCANNER_TIMEOUT_MS'] = '9000';
    component.startReplacing(find('SCANNER_FTP_PASSWORD'));
    component.draft['SCANNER_FTP_PASSWORD'] = 'new-password';
    component.toggleReset(find('LAPPER_TIME_ZONE'));
    expect(component.changedCount).toBe(3);

    component.save();
    const request = http.expectOne({ method: 'PUT', url: API });
    expect(request.request.body).toEqual({ changes: [
      { key: 'SCANNER_TIMEOUT_MS', value: '9000' },
      { key: 'SCANNER_FTP_PASSWORD', value: 'new-password' },
      { key: 'LAPPER_TIME_ZONE', value: null },
    ] });
    request.flush(board({ restart_required: true }));
    fixture.detectChanges();
    expect(component.changedCount).toBe(0);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Restart needed.');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Restart the API where it was started.');
  });

  it('keeps the typed values and shows the reason when a save is refused', () => {
    component.draft['SCANNER_TIMEOUT_MS'] = 'soon';
    component.save();
    http.expectOne({ method: 'PUT', url: API }).flush({ message: 'Not saved. SCANNER_TIMEOUT_MS must be a number.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(component.error).toContain('SCANNER_TIMEOUT_MS must be a number');
    expect(component.draft['SCANNER_TIMEOUT_MS']).toBe('soon');
    expect(component.changedCount).toBe(1);
  });

  it('finds settings by name or key and discards edits', () => {
    component.search = 'time_zone';
    expect(component.visibleGroups.flatMap((group) => group.settings).map((item) => item.key)).toEqual(['LAPPER_TIME_ZONE']);
    component.draft['SCANNER_TIMEOUT_MS'] = '1';
    component.discard();
    expect(component.draft['SCANNER_TIMEOUT_MS']).toBe('4000');
  });
});
