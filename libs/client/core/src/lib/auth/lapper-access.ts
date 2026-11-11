import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthSessionService } from '@meshforge/manufacturing/frontend/data-access-user';

/**
 * What the signed-in user may do in Lapper. The API lets only MeshForge
 * administrators change setup data (machines, parts, scanners, macros …),
 * so everyone else gets read-only screens instead of buttons that fail.
 */
@Injectable({ providedIn: 'root' })
export class LapperAccess {
  private readonly session = inject(AuthSessionService);
  private readonly user = toSignal(this.session.authState$, {
    initialValue: this.session.currentUser,
  });

  readonly canEditSetup = computed(() => String(this.user()?.role ?? '').toLowerCase() === 'admin');
}
