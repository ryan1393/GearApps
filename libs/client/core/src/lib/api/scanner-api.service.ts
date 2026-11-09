import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ScannerCommand, ScannerLogEntry, ScannerSummary } from '@gearapps/shared/domain';
import { Observable } from 'rxjs';
import { API_BASE_URL } from './api-config';

/** Live scanner integration (image, status, commands), keyed by scanner id. */
@Injectable({ providedIn: 'root' })
export class ScannerApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/scanner`;

  image(scannerId: string): Observable<Blob> {
    return this.http.get(`${this.url}/${scannerId}/image`, { responseType: 'blob' });
  }

  summary(scannerId: string): Observable<ScannerSummary> {
    return this.http.get<ScannerSummary>(`${this.url}/${scannerId}/summary`);
  }

  log(scannerId: string): Observable<ScannerLogEntry[]> {
    return this.http.get<ScannerLogEntry[]>(`${this.url}/${scannerId}/log`);
  }

  command(scannerId: string, data: string): Observable<ScannerCommand> {
    return this.http.post<ScannerCommand>(`${this.url}/${scannerId}/command`, { data });
  }
}
