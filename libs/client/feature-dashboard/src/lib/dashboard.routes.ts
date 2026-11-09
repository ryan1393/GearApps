import { Routes } from '@angular/router';

export const dashboardRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./cells-overview-page.component').then((m) => m.CellsOverviewPageComponent),
    title: 'Lapping cells · GearApps',
  },
  {
    path: 'cell/:cell',
    loadComponent: () => import('./cell-live-page.component').then((m) => m.CellLivePageComponent),
    title: 'Cell live view · GearApps',
  },
];
