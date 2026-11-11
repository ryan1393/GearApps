import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CollectorToken, CreatedCollectorToken, DockerCollectorConnection } from '@meshforge/shared/domain';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api-config';

/** One machine as reported by the Lapper Read supervisor (no IPs or raw errors). */
export interface CollectorMachine {
  machine_id: string;
  /** True when a worker is running for this machine. */
  worker: boolean;
  /** Worker phase ("collecting", "controller unavailable", …) or why there is no worker. */
  phase: string | null;
  last_sample_at?: string | null;
  pending_runs?: number;
  /** 'none' when no Active scanner is assigned; 'offline' scanners are pinged and retried. */
  scanner?: 'online' | 'offline' | 'none' | null;
  scanner_ping?: 'answers' | 'no answer' | 'unknown' | null;
  scanner_last_seen?: string | null;
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

/** Admin management of the tokens collectors sign in with. */
@Injectable({ providedIn: 'root' })
export class CollectorTokensApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/collector-token`;

  list(): Observable<CollectorToken[]> {
    return this.http.get<CollectorToken[]>(this.url);
  }

  create(name: string): Observable<CreatedCollectorToken> {
    return this.http.post<CreatedCollectorToken>(this.url, { name });
  }

  revoke(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }

  dockerConnection(): Observable<DockerCollectorConnection> {
    return this.http.get<DockerCollectorConnection>(`${this.url}/docker`);
  }

  /** Issues the Docker collector a new token on its private volume; the previous one is revoked. */
  connectDocker(): Observable<DockerCollectorConnection> {
    return this.http.post<DockerCollectorConnection>(`${this.url}/docker`, {});
  }
}
