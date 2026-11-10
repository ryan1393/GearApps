import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

/** One machine as reported by the Lapper Read supervisor (no IPs or raw errors). */
export interface CollectorMachine {
  machine_id: string;
  /** True when a worker is running for this machine. */
  worker: boolean;
  /** Worker phase ("collecting", "controller unavailable", …) or why there is no worker. */
  phase: string | null;
  last_sample_at?: string | null;
  pending_runs?: number;
}

export interface CollectorStatus {
  last_discovery: string | null;
  machines: CollectorMachine[];
}

/** Lapper Read worker status, proxied by the Lapper web server at /collector/machines. */
@Injectable({ providedIn: 'root' })
export class CollectorApi {
  private readonly http = inject(HttpClient);

  status(): Observable<CollectorStatus> {
    return this.http.get<CollectorStatus>('/collector/machines');
  }
}
