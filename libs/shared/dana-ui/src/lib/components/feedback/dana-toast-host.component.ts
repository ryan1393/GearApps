import { AsyncPipe, CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, inject } from '@angular/core';
import { map } from 'rxjs';
import { DanaToastNotice, DanaToastService, isDanaToastError } from './dana-toast.service';

/**
 * Two sibling live regions, never nested: errors are announced assertively and stay until
 * dismissed; other notices are announced politely and pause while hovered or focused.
 */
@Component({ selector: 'dana-toast-host, gear-toast-host', standalone: true, imports:[CommonModule,AsyncPipe], changeDetection:ChangeDetectionStrategy.OnPush, template:`<div class="dana-toast-stack gear-toast-stack"><div class="dana-toast-region dana-toast-region-polite" aria-live="polite" aria-relevant="additions" aria-atomic="false"><ng-container *ngFor="let notice of politeNotices$ | async; trackBy: trackById"><ng-container *ngTemplateOutlet="toastTemplate; context: { $implicit: notice }"></ng-container></ng-container></div><div class="dana-toast-region dana-toast-region-assertive" aria-live="assertive" aria-relevant="additions" aria-atomic="false"><ng-container *ngFor="let notice of errorNotices$ | async; trackBy: trackById"><ng-container *ngTemplateOutlet="toastTemplate; context: { $implicit: notice }"></ng-container></ng-container></div></div><ng-template #toastTemplate let-notice><article class="dana-toast gear-toast" [class.toast-success]="notice.tone === 'success'" [class.toast-warning]="notice.tone === 'warning'" [class.toast-error]="isError(notice)" [class.toast-info]="notice.tone === 'info'" (mouseenter)="hold(notice, 'pointer')" (mouseleave)="release(notice, 'pointer')" (focusin)="hold(notice, 'focus')" (focusout)="release(notice, 'focus')"><div class="dana-toast-icon gear-toast-icon" aria-hidden="true">{{ notice.tone === 'success' ? '✓' : notice.tone === 'warning' ? '!' : isError(notice) ? '!' : 'i' }}</div><div class="dana-toast-copy gear-toast-copy"><strong>{{ notice.title }}</strong><span>{{ notice.message }}</span></div><button type="button" class="dana-toast-close gear-toast-close" aria-label="Dismiss notification" (click)="dismiss(notice)">×</button></article></ng-template>` })
export class DanaToastHostComponent implements OnDestroy {
  readonly toast = inject(DanaToastService);
  readonly politeNotices$ = this.toast.notices$.pipe(map(notices => notices.filter(notice => !isDanaToastError(notice.tone))));
  readonly errorNotices$ = this.toast.notices$.pipe(map(notices => notices.filter(notice => isDanaToastError(notice.tone))));
  private readonly holds = new Map<number, Set<'pointer' | 'focus'>>();
  trackById(_i:number,n:DanaToastNotice){return n.id}
  isError(notice:DanaToastNotice){return isDanaToastError(notice.tone)}
  hold(notice:DanaToastNotice, reason:'pointer'|'focus'){
    const reasons=this.holds.get(notice.id)??new Set<'pointer'|'focus'>();
    reasons.add(reason);this.holds.set(notice.id,reasons);this.toast.pause(notice.id);
  }
  release(notice:DanaToastNotice, reason:'pointer'|'focus'){
    const reasons=this.holds.get(notice.id);if(!reasons)return;
    reasons.delete(reason);if(reasons.size)return;
    this.holds.delete(notice.id);this.toast.resume(notice.id);
  }
  dismiss(notice:DanaToastNotice){this.holds.delete(notice.id);this.toast.dismiss(notice.id)}
  ngOnDestroy(){for(const id of this.holds.keys())this.toast.resume(id);this.holds.clear()}
}
