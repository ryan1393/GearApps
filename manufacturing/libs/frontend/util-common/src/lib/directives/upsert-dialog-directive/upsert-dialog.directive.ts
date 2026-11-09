import { Directive, inject, OnInit } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { DialogRef } from '@ngneat/dialog';
import { loadingFor } from '@ngneat/loadoff';

import { GearToastService } from '../../toast/gear-toast.service';
import { UpsertDialogData } from './upsert-dialog-data.interface';

export const LOADING_FOR_UPSERT = 'upsert';

@Directive()
export abstract class UpsertDialogComponent<
  Entity extends Record<string, unknown>,
> implements OnInit
{
  private readonly toast = inject(GearToastService);
  loader = loadingFor(LOADING_FOR_UPSERT);
  ref: DialogRef<UpsertDialogData<Entity>> = inject(DialogRef);

  abstract get form(): FormGroup;

  abstract getMessages(): Record<UpsertDialogData<Entity>['action'], string>;

  get action() {
    return this.ref.data.action;
  }

  ngOnInit() {
    if (this.ref.data.action === 'edit') {
      if (this.ref.data.currentValue) {
        this.form.patchValue(this.ref.data.currentValue);
      } else {
        throw new Error(
          `Upsert action was set to 'edit' but no currentValue was provided!`,
        );
      }
    }
  }

  upsert(...args: unknown[]) {
    if (this.form.invalid) return;

    this.ref.data.actions$[this.action](this.form.getRawValue(), ...args)
      .pipe(this.loader.upsert.track())
      .subscribe(() => {
        this.ref.close();
        this.toast.success(
          this.getMessages()[this.action],
          this.action === 'add' ? 'Created' : 'Updated',
        );
      });
  }
}
