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
import { Client as FtpClient, FTPError } from 'basic-ftp';
import * as https from 'https';
import { createConnection } from 'node:net';
import { Writable } from 'stream';

interface ScannerImage {
  data: Buffer;
  contentType: 'image/jpeg' | 'image/bmp';
}

/**
 * Talks to a lapping-cell barcode scanner over HTTP and TCP, and to
 * the plant FTP drop where each scanner publishes its latest capture.
 *
 * All hosts/credentials come from configuration; nothing is hard-coded here.
 */
@Injectable()
export class ScannerClientService {
  private readonly logger = new Logger(ScannerClientService.name);
  private readonly http: AxiosInstance;
  /**
   * Short-lived image cache plus one shared fetch per scanner, so live cards polling every
   * second (the fastest Live View setting) cost one FTP login per scanner, not one per viewer.
   */
  private readonly imageCache = new Map<string, { at: number; image: ScannerImage }>();
  private readonly imageFetches = new Map<string, Promise<ScannerImage>>();
  /** At least the fastest UI poll period (1 s), with room for the requests to drift. */
  static readonly IMAGE_TTL_MS = 1_500;
  private static readonly MAX_IMAGE_BYTES = 16 * 1024 * 1024;

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
    if (command.data === 'TUNE01' || command.data === 'FTUNE') {
      return this.sendTuningCommand(host, command.data);
    }
    return this.sendWebCommand(host, command);
  }

  async sendWebCommand(host: string, command: ScannerCommand): Promise<ScannerCommand> {
    const url = `https://${host}/command.cgi?op=${encodeURIComponent(command.data)}`;
    const { data } = await this.request<unknown>(host, url);
    return { data: typeof data === 'string' ? data : JSON.stringify(data) };
  }

  private async sendTuningCommand(host: string, op: 'TUNE01' | 'FTUNE'): Promise<ScannerCommand> {
    const port = this.cfg.commandPort;
    const socket = createConnection({ host, port });
    const timeout = setTimeout(
      () => socket.destroy(new Error('timed out waiting for acknowledgement')),
      this.cfg.timeoutMs,
    );
    const replyCommand = op === 'TUNE01' ? 'TUNE' : op;

    try {
      socket.once('connect', () => socket.write(`${op}\r`, 'ascii'));
      socket.setEncoding('ascii');
      let partial = '';
      for await (const chunk of socket) {
        const frames = (partial + chunk).split(/[\r\n]/);
        partial = frames.pop() ?? '';
        if (partial.length > 8192) throw new Error('response exceeded the maximum frame length');
        for (const frame of frames) {
          if (frame.length > 8192) throw new Error('response exceeded the maximum frame length');
          if (
            frame === 'OK' ||
            frame === `OK,${op}` ||
            frame === `OK,${replyCommand}` ||
            frame.startsWith(`OK,${replyCommand},`)
          ) {
            return { data: frame };
          }
          if (/^ER(?:R|,|$)/.test(frame)) throw new Error(`rejected the command (${frame})`);
        }
      }
      throw new Error('closed the connection before acknowledging the command');
    } catch (error) {
      const message = `Scanner ${host}:${port} ${String((error as Error).message)}`;
      this.logger.warn(`${op}: ${message}`);
      throw new BadGatewayException(message);
    } finally {
      clearTimeout(timeout);
      socket.destroy();
    }
  }

  /** Latest capture for `host` (JPEG or BMP), shared by every viewer asking at the same time. */
  async getLatestImage(host: string): Promise<ScannerImage> {
    const cached = this.imageCache.get(host);
    if (cached && Date.now() - cached.at < ScannerClientService.IMAGE_TTL_MS) return cached.image;
    // Viewers asking while a fetch is under way share it (and its failure, which is not cached).
    const pending = this.imageFetches.get(host);
    if (pending) return pending;
    const fetch = this.fetchImage(host).finally(() => this.imageFetches.delete(host));
    this.imageFetches.set(host, fetch);
    return fetch;
  }

  private async fetchImage(host: string): Promise<ScannerImage> {
    const { ftp } = this.cfg;
    if (!ftp.host) throw new BadGatewayException('Scanner FTP host is not configured');

    const client = new FtpClient(this.cfg.timeoutMs);
    const folder = `${ftp.root.replace(/\/+$/, '')}/${host}`;

    try {
      await client.access({
        host: ftp.host,
        user: ftp.user,
        password: ftp.password,
        secure: false,
      });
      const image =
        (await this.downloadImage(client, `${folder}/${ftp.imageFile}`)) ??
        (await this.newestImage(client, folder, ftp.imageFile));
      if (!image) throw new Error(`No complete JPEG or BMP capture in ${folder}`);

      this.imageCache.set(host, { at: Date.now(), image });
      return image;
    } catch (err) {
      this.logger.warn(`FTP image fetch failed for ${host}: ${(err as Error).message}`);
      throw new BadGatewayException(`Could not fetch image for scanner ${host}`);
    } finally {
      client.close();
    }
  }

  private async newestImage(client: FtpClient, folder: string, configuredName: string) {
    const files = (await client.list(folder)).filter(
      (file) =>
        file.isFile &&
        file.name !== configuredName &&
        /^[^/\\\r\n]+\.(?:jpe?g|bmp)$/i.test(file.name) &&
        file.size <= ScannerClientService.MAX_IMAGE_BYTES,
    );
    const captures: { path: string; timestamp: number }[] = [];
    for (const file of files) {
      const path = `${folder}/${file.name}`;
      const modified = file.modifiedAt ?? (await client.lastMod(path));
      captures.push({ path, timestamp: modified.getTime() });
    }
    captures.sort((a, b) => b.timestamp - a.timestamp || b.path.localeCompare(a.path));
    // A file being uploaded may be listed before its image bytes are complete.
    for (const { path } of captures.slice(0, 3)) {
      const image = await this.downloadImage(client, path);
      if (image) return image;
    }
    return null;
  }

  private async downloadImage(client: FtpClient, path: string): Promise<ScannerImage | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > ScannerClientService.MAX_IMAGE_BYTES) {
          done(new Error('Scanner image exceeds the maximum size'));
          return;
        }
        chunks.push(chunk);
        done();
      },
    });
    try {
      await client.downloadTo(sink, path);
    } catch (error) {
      if (error instanceof FTPError && error.code === 550) return null;
      throw error;
    }

    const data = Buffer.concat(chunks, size);
    if (size >= 4 && data.readUInt16BE(0) === 0xffd8 && data.readUInt16BE(size - 2) === 0xffd9) {
      return { data, contentType: 'image/jpeg' };
    }
    if (size >= 26 && data.readUInt16BE(0) === 0x424d && data.readUInt32LE(2) === size) {
      return { data, contentType: 'image/bmp' };
    }
    return null;
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
