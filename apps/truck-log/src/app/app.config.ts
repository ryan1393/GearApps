import { truckLogAdminInterceptor } from '@truck-log/web/auth/admin';
import { truckLogStationInterceptor } from '@truck-log/web/auth/station';
import { ApplicationConfig } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
export const appConfig: ApplicationConfig = { providers: [provideHttpClient(withInterceptors([truckLogAdminInterceptor, truckLogStationInterceptor])), provideRouter(routes)] };
