import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
export type DanaToastTone = 'success' | 'warning' | 'error' | 'info';
export interface DanaToastNotice { id:number; tone:DanaToastTone; title:string; message:string; durationMs:number; }
@Injectable({ providedIn: 'root' })
export class DanaToastService {
  private nextId=1; private readonly noticesSubject=new BehaviorSubject<DanaToastNotice[]>([]); readonly notices$=this.noticesSubject.asObservable();
  success(message:string,title='Done',durationMs=4500){this.show('success',title,message,durationMs)}
  warning(message:string,title='Attention',durationMs=6500){this.show('warning',title,message,durationMs)}
  error(message:string,title='Something went wrong',durationMs=6500){this.show('error',title,message,durationMs)}
  info(message:string,title='Notice',durationMs=5000){this.show('info',title,message,durationMs)}
  dismiss(id:number){this.noticesSubject.next(this.noticesSubject.value.filter(n=>n.id!==id))}
  private show(tone:DanaToastTone,title:string,message:string,durationMs:number){const notice={id:this.nextId++,tone,title,message,durationMs};this.noticesSubject.next([...this.noticesSubject.value,notice].slice(-4));globalThis.setTimeout(()=>this.dismiss(notice.id),durationMs)}
}
