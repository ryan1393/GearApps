import { Routes } from '@angular/router';

export const machinesRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./machines-page.component').then((m) => m.MachinesPageComponent),
  },
];
