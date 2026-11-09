import { Routes } from '@angular/router';

export const lappingSummaryRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./lapping-summary-page.component').then((m) => m.LappingSummaryPageComponent),
    title: 'Lapping summaries · GearApps',
  },
];
