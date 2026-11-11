import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';
import { of } from 'rxjs';
import { FrontendFeatureLoginComponent } from './frontend-feature-login.component';

describe('FrontendFeatureLoginComponent', () => {
  let fixture: ComponentFixture<FrontendFeatureLoginComponent>;
  let login: jest.Mock;
  beforeEach(async () => {
    login = jest.fn(() => of({ accessToken: 'access', refreshToken: 'refresh' }));
    await TestBed.configureTestingModule({ imports: [FrontendFeatureLoginComponent], providers: [
      { provide: AuthSessionService, useValue: { authState$: of(null), login } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      { provide: Router, useValue: { navigate: jest.fn().mockResolvedValue(true), navigateByUrl: jest.fn().mockResolvedValue(true) } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(FrontendFeatureLoginComponent); fixture.detectChanges();
  });
  it('creates the sign-in form', () => expect(fixture.componentInstance).toBeTruthy());
  it('submits the typed password without requiring the field to blur', () => {
    const email: HTMLInputElement = fixture.nativeElement.querySelector('#email');
    const password: HTMLInputElement = fixture.nativeElement.querySelector('#password');
    email.value = 'operator@example.com'; email.dispatchEvent(new Event('input', { bubbles: true }));
    password.value = 'Password1!'; password.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(login).toHaveBeenCalledWith({ email: 'operator@example.com', password: 'Password1!' });
  });
});
