import { scannerConfig } from '@meshforge/api/core';
import {
  ScannerCommand,
  ScannerLog,
  ScannerLogEntry,
  ScannerSummary,
} from '@meshforge/shared/domain';
import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Client as FtpClient } from 'basic-ftp';
import * as https from 'https';
import { Writable } from 'stream';

/**
 * Talks to a lapping-cell barcode scanner: its HTTP API for status/commands and
 * the plant FTP drop where each scanner publishes its latest capture.
 *
 * All hosts/credentials come from configuration; nothing is hard-coded here.
 */
@Injectable()
export class ScannerClientService {
  private readonly logger = new Logger(ScannerClientService.name);
  private readonly http: AxiosInstance;
  /** Short-lived image cache so a 1 s UI poll doesn't become 1 FTP login per request per viewer. */
  private readonly imageCache = new Map<string, { at: number; data: Buffer }>();
  private static readonly IMAGE_TTL_MS = 900;

  constructor(@Inject(scannerConfig.KEY) private readonly cfg: ConfigType<typeof scannerConfig>) {
    this.http = axios.create({
      timeout: cfg.timeoutMs,
      httpsAgent: new https.Agent({ rejectUnauthorized: !cfg.allowInsecureTls }),
      headers: { Accept: 'application/json' },
    });
  }

  async getSummary(host: string): Promise<ScannerSummary> {
    const { data } = await this.request<ScannerSummary>(host, `http://${host}/api/get/v1/summary`);
    return data;
  }

  async getCommandLog(host: string): Promise<ScannerLogEntry[]> {
    const { data } = await this.request<ScannerLog>(host, `https://${host}/api/get/v1/commandlog`);
    return data?.event_object ?? [];
  }

  async sendCommand(host: string, command: ScannerCommand): Promise<ScannerCommand> {
    const url = `https://${host}/command.cgi?op=${encodeURIComponent(command.data)}`;
    const { data } = await this.request<unknown>(host, url);
    return { data: typeof data === 'string' ? data : JSON.stringify(data) };
  }

  /** Latest capture from the scanner's FTP folder, as a JPEG buffer. */
  async getLatestImage(host: string): Promise<Buffer> {
    const cached = this.imageCache.get(host);
    if (cached && Date.now() - cached.at < ScannerClientService.IMAGE_TTL_MS) return cached.data;

    const { ftp } = this.cfg;
    if (!ftp.host) throw new BadGatewayException('Scanner FTP host is not configured');

    const client = new FtpClient(this.cfg.timeoutMs);
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    });

    try {
      await client.access({
        host: ftp.host,
        user: ftp.user,
        password: ftp.password,
        secure: false,
      });
      await client.downloadTo(sink, `${ftp.root}/${host}/${ftp.imageFile}`);
    } catch (err) {
      this.logger.warn(`FTP image fetch failed for ${host}: ${(err as Error).message}`);
      throw new BadGatewayException(`Could not fetch image for scanner ${host}`);
    } finally {
      client.close();
    }

    const data = Buffer.concat(chunks);
    this.imageCache.set(host, { at: Date.now(), data });
    return data;
  }

  private async request<T>(host: string, url: string) {
    try {
      return await this.http.get<T>(url);
    } catch (err) {
      this.logger.warn(`Scanner ${host} request failed: ${(err as Error).message}`);
      throw new BadGatewayException(`Scanner ${host} did not respond`);
    }
  }
}
