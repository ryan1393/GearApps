import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ScannerCommand,
  ScannerFtpListing,
  ScannerImageDefaults,
  ScannerLogEntry,
  ScannerSummary,
} from '@meshforge/shared/domain';
import { Observable, shareReplay, tap } from 'rxjs';
import { API_BASE_URL } from './api-config';

/** Live scanner integration (image, status, commands), keyed by scanner id. */
@Injectable({ providedIn: 'root' })
export class ScannerApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/scanner`;

  private defaults$: Observable<ScannerImageDefaults> | null = null;

  /**
   * The server's default capture folder root and file name, fetched once and shared by every
   * caller; a failed request is not kept, so the next caller asks again.
   */
  imageDefaults(): Observable<ScannerImageDefaults> {
    this.defaults$ ??= this.http.get<ScannerImageDefaults>(`${this.url}/image-defaults`).pipe(
      tap({ error: () => (this.defaults$ = null) }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.defaults$;
  }

  image(scannerId: string): Observable<Blob> {
    return this.http.get(`${this.url}/${scannerId}/image`, { responseType: 'blob' });
  }

  summary(scannerId: string): Observable<ScannerSummary> {
    return this.http.get<ScannerSummary>(`${this.url}/${scannerId}/summary`);
  }

  log(scannerId: string): Observable<ScannerLogEntry[]> {
    return this.http.get<ScannerLogEntry[]>(`${this.url}/${scannerId}/log`);
  }

  /** One folder of the scanner FTP drop (administrators); no path lists SCANNER_FTP_ROOT. */
  browseFtp(path?: string): Observable<ScannerFtpListing> {
    return this.http.get<ScannerFtpListing>(`${this.url}/ftp/browse`, { params: path ? { path } : {} });
  }

  command(scannerId: string, data: string): Observable<ScannerCommand> {
    return this.http.post<ScannerCommand>(`${this.url}/${scannerId}/command`, { data });
  }
}
