import { Routes } from '@angular/router';

export const partsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./parts-page.component').then((m) => m.PartsPageComponent),
    title: 'Parts & gearsets · GearApps',
  },
];

export const summariesRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./summaries-page.component').then((m) => m.SummariesPageComponent),
    title: 'Part summaries · GearApps',
  },
];
