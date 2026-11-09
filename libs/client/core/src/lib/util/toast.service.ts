import { inject, Injectable } from '@angular/core';
import { DanaToastService } from '@dana/ui';
import { apiErrorMessage } from './api-error';

/** Thin wrapper over Dana UI's toast service so features don't repeat message plumbing. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly toast = inject(DanaToastService);

  success(title: string, message = '') {
    this.toast.success(message, title);
  }

  info(title: string, message = '') {
    this.toast.info(message, title);
  }

  warning(title: string, message = '') {
    this.toast.warning(message, title);
  }

  error(err: unknown, title = 'Something went wrong') {
    this.toast.error(apiErrorMessage(err), title);
  }
}
