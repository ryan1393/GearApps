import { CanActivateFn, Router, Routes } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService, guestGuard } from '@gearapps/client/core';
import { catchError, map, of } from 'rxjs';

const registrationGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(AuthService)
    .capabilities()
    .pipe(
      map(({ registrationEnabled }) => registrationEnabled || router.createUrlTree(['/login'])),
      catchError(() => of(router.createUrlTree(['/login']))),
    );
};

export const authRoutes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./login.component').then((m) => m.LoginComponent),
    title: 'Sign in · GearApps',
  },
  {
    path: 'register',
    canActivate: [guestGuard, registrationGuard],
    loadComponent: () => import('./register.component').then((m) => m.RegisterComponent),
    title: 'Create account · GearApps',
  },
];
