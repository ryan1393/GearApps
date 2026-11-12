import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { Component } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, RouterOutlet } from '@angular/router';
import { jwtInterceptor } from '@meshforge/manufacturing/frontend/data-access-common';
import { plantDashboardRoutes } from '@meshforge/manufacturing/frontend/feature-plant-dashboard';

@Component({
  selector: 'gear-plant-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
class PlantAppComponent {}

void bootstrapApplication(PlantAppComponent, {
  providers: [
    provideHttpClient(withInterceptors([jwtInterceptor])),
    provideRouter(plantDashboardRoutes),
  ],
}).catch((error) => console.error(error));
