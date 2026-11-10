import { Routes } from '@angular/router';

export const partsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./parts-page.component').then((m) => m.PartsPageComponent),
  },
];

export const summariesRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./summaries-page.component').then((m) => m.SummariesPageComponent),
  },
];
