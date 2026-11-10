import { Routes } from '@angular/router';

export const scannersRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./scanners-page.component').then((m) => m.ScannersPageComponent),
  },
];

export const macrosRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./macros-page.component').then((m) => m.MacrosPageComponent),
  },
];

export const fanucVariablesRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./fanuc-variables-page.component').then((m) => m.FanucVariablesPageComponent),
  },
];
