import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
/** 'danger' is accepted as another name for 'error', matching danaAlert and badge tones. */
export type DanaToastTone = 'success' | 'warning' | 'error' | 'info' | 'danger';
export interface DanaToastNotice { id:number; tone:DanaToastTone; title:string; message:string; durationMs:number; }

interface DanaToastTimer { handle?: ReturnType<typeof setTimeout>; remainingMs: number; startedAt: number; }

/** True for the tones announced assertively and kept until the user dismisses them. */
export function isDanaToastError(tone: DanaToastTone): boolean {
  return tone === 'error' || tone === 'danger';
}

@Injectable({ providedIn: 'root' })
export class DanaToastService implements OnDestroy {
  private nextId=1; private readonly noticesSubject=new BehaviorSubject<DanaToastNotice[]>([]); readonly notices$=this.noticesSubject.asObservable();
  private readonly timers=new Map<number, DanaToastTimer>();
  success(message:string,title='Done',durationMs=4500){this.show('success',title,message,durationMs)}
  warning(message:string,title='Attention',durationMs=6500){this.show('warning',title,message,durationMs)}
  /** Errors stay until dismissed; durationMs is kept for source compatibility only. */
  error(message:string,title='Something went wrong',durationMs=0){this.show('error',title,message,durationMs)}
  danger(message:string,title='Something went wrong',durationMs=0){this.show('error',title,message,durationMs)}
  info(message:string,title='Notice',durationMs=5000){this.show('info',title,message,durationMs)}
  /** Shows a notice by tone name; 'danger' and 'error' are the same tone. */
  notify(tone:DanaToastTone,message:string,title?:string,durationMs?:number){
    if(isDanaToastError(tone)) this.error(message,title,durationMs);
    else if(tone==='success') this.success(message,title,durationMs);
    else if(tone==='warning') this.warning(message,title,durationMs);
    else this.info(message,title,durationMs);
  }
  dismiss(id:number){this.clearTimer(id);this.noticesSubject.next(this.noticesSubject.value.filter(n=>n.id!==id))}
  /** Stops a notice's countdown while the pointer or keyboard focus is on it. */
  pause(id:number){const timer=this.timers.get(id);if(!timer||timer.handle===undefined)return;globalThis.clearTimeout(timer.handle);timer.handle=undefined;timer.remainingMs=Math.max(0,timer.remainingMs-(Date.now()-timer.startedAt))}
  resume(id:number){const timer=this.timers.get(id);if(!timer||timer.handle!==undefined)return;this.startTimer(id,timer)}
  ngOnDestroy(){for(const id of [...this.timers.keys()])this.clearTimer(id)}
  private show(tone:DanaToastTone,title:string,message:string,durationMs:number){
    const normalized:DanaToastTone=isDanaToastError(tone)?'error':tone;
    const notice={id:this.nextId++,tone:normalized,title,message,durationMs};
    const kept=[...this.noticesSubject.value,notice].slice(-4);
    for(const dropped of this.noticesSubject.value) if(!kept.includes(dropped)) this.clearTimer(dropped.id);
    this.noticesSubject.next(kept);
    if(!isDanaToastError(normalized)&&durationMs>0) this.startTimer(notice.id,{remainingMs:durationMs,startedAt:Date.now()});
  }
  private startTimer(id:number,timer:DanaToastTimer){timer.startedAt=Date.now();timer.handle=globalThis.setTimeout(()=>this.dismiss(id),timer.remainingMs);this.timers.set(id,timer)}
  private clearTimer(id:number){const timer=this.timers.get(id);if(timer?.handle!==undefined)globalThis.clearTimeout(timer.handle);this.timers.delete(id)}
}
