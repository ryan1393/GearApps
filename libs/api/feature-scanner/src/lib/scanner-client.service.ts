import { dockerCollectorTokenFile, isPrivateAddress, privateNetworkLookup, scannerConfig } from '@meshforge/api/core';
import {
  ScannerCommand,
  ScannerFtpListing,
  ScannerLog,
  ScannerLogEntry,
  ScannerSummary,
} from '@meshforge/shared/domain';
import { BadGatewayException, BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Client as FtpClient, FTPError } from 'basic-ftp';
import * as https from 'https';
import { readFile } from 'node:fs/promises';
import { Agent as HttpAgent } from 'node:http';
import { createConnection, isIP } from 'node:net';
import { Writable } from 'stream';

/** A scanner's own image folder and file; empty values use the defaults. */
export interface ScannerImageLocation {
  folder?: string | null;
  file?: string | null;
}

export interface ScannerImage {
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
  private static readonly MAX_LISTING = 2000;
  /** Above the collector's own 20 s wait, so its answer (or its timeout message) arrives first. */
  static readonly COLLECTOR_TIMEOUT_MS = 25_000;

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

  /**
   * Sends a dashboard op code. A scanner accepts one command connection, and Lapper Read holds it
   * for every scanner it reads, so the command goes through the collector first. A scanner the
   * collector does not read (or no collector) is reached directly, as before.
   */
  async sendCommand(host: string, command: ScannerCommand): Promise<ScannerCommand> {
    const viaCollector = await this.sendViaCollector(host, command.data);
    if (viaCollector) return viaCollector;
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

  /** The collector's reply, or null when it does not hold this scanner (or cannot be asked). */
  private async sendViaCollector(host: string, op: string): Promise<ScannerCommand | null> {
    const file = dockerCollectorTokenFile();
    const token = file ? (await readFile(file, 'utf8').catch(() => '')).trim() : '';
    if (!token) return null;
    const base = this.cfg.collectorUrl.replace(/\/+$/, '');
    let collectorHost: string;
    try {
      collectorHost = new URL(base).hostname.replace(/^\[|\]$/g, '');
    } catch {
      return null;
    }
    // The request carries the collector token, so it only goes to this host or the private network.
    if (isIP(collectorHost) && !isPrivateAddress(collectorHost)) {
      this.logger.warn(`LAPPER_READ_STATUS_URL (${base}) is outside the private network; scanner ${host} is reached directly`);
      return null;
    }
    let reply;
    try {
      reply = await axios.post(
        `${base}/scanners/${encodeURIComponent(host)}/command`,
        { command: op },
        {
          timeout: ScannerClientService.COLLECTOR_TIMEOUT_MS,
          proxy: false,
          httpAgent: new HttpAgent({ lookup: privateNetworkLookup() } as never),
          maxRedirects: 0,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          validateStatus: () => true,
        },
      );
    } catch (error) {
      this.logger.debug(`Lapper Read not reachable for scanner ${host} (${(error as Error).message}); connecting directly`);
      return null;
    }
    if (reply.status === 404) return null;
    if (reply.status === 401) {
      this.logger.warn(`Lapper Read refused the collector token; scanner ${host} is reached directly`);
      return null;
    }
    const data = reply.data as { reply?: unknown; message?: unknown } | undefined;
    if (reply.status !== 200 || typeof data?.reply !== 'string') {
      const message = typeof data?.message === 'string' ? data.message : `Lapper Read answered HTTP ${reply.status}`;
      this.logger.warn(`${op} via Lapper Read: ${message}`);
      throw new BadGatewayException(message);
    }
    if (/^ER/.test(data.reply)) throw new BadGatewayException(`Scanner ${host} rejected the command (${data.reply})`);
    return { data: data.reply };
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

  /**
   * The FTP folder and file of a scanner's capture: its own (Admin > Scanners) when set, otherwise
   * `<SCANNER_FTP_ROOT>/<scanner IP>/<SCANNER_FTP_IMAGE_FILE>`.
   */
  imageLocation(host: string | null, location: ScannerImageLocation = {}): { folder: string; file: string } {
    const folder = location.folder?.trim().replace(/\/+$/, '');
    const file = location.file?.trim() || this.cfg.ftp.imageFile;
    if (folder) return { folder, file };
    if (!host) throw new BadRequestException('Set the scanner\'s IP address or its image folder');
    return { folder: `${this.cfg.ftp.root.replace(/\/+$/, '')}/${host}`, file };
  }

  /**
   * Latest capture for a scanner (JPEG or BMP), shared by every viewer asking at the same time.
   * `label` names the scanner in errors (its IP, or its id when only a folder is set).
   */
  async getLatestImage(host: string | null, location: ScannerImageLocation = {}, label = host ?? 'scanner'): Promise<ScannerImage> {
    const where = this.imageLocation(host, location);
    const key = `${where.folder}/${where.file}`;
    const cached = this.imageCache.get(key);
    if (cached && Date.now() - cached.at < ScannerClientService.IMAGE_TTL_MS) return cached.image;
    // Viewers asking while a fetch is under way share it (and its failure, which is not cached).
    const pending = this.imageFetches.get(key);
    if (pending) return pending;
    const fetch = this.fetchImage(key, where, label).finally(() => this.imageFetches.delete(key));
    this.imageFetches.set(key, fetch);
    return fetch;
  }

  /** One level of the FTP drop: sub-folders and JPEG/BMP captures (newest first). */
  async listFtpFolder(path?: string): Promise<ScannerFtpListing> {
    const { ftp } = this.cfg;
    if (!ftp.host) throw new BadGatewayException('Scanner FTP host is not configured');
    const folder = (path?.trim() || ftp.root).replace(/\/+$/, '') || '/';
    if (/(^|\/)\.\.(\/|$)/.test(folder) || /[\\\p{Cc}]/u.test(folder)) {
      throw new BadRequestException("Folder paths cannot contain '..' or backslashes");
    }
    const client = new FtpClient(this.cfg.timeoutMs);
    try {
      await client.access({ host: ftp.host, user: ftp.user, password: ftp.password, secure: false });
      const entries = (await client.list(folder)).slice(0, ScannerClientService.MAX_LISTING);
      return {
        path: folder,
        root: ftp.root,
        defaultImageFile: ftp.imageFile,
        folders: entries.filter((e) => e.isDirectory && e.name !== '.' && e.name !== '..').map((e) => e.name).sort(),
        images: entries
          .filter((e) => e.isFile && /\.(?:jpe?g|bmp)$/i.test(e.name))
          .map((e) => ({ name: e.name, size: e.size, modifiedAt: e.modifiedAt?.toISOString() ?? null }))
          .sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '') || a.name.localeCompare(b.name)),
      };
    } catch (err) {
      if (err instanceof FTPError && err.code === 550) throw new NotFoundException(`FTP folder ${folder} does not exist`);
      this.logger.warn(`FTP listing failed for ${folder}: ${(err as Error).message}`);
      throw new BadGatewayException(`Could not list FTP folder ${folder}`);
    } finally {
      client.close();
    }
  }

  private async fetchImage(key: string, where: { folder: string; file: string }, label: string): Promise<ScannerImage> {
    const { ftp } = this.cfg;
    if (!ftp.host) throw new BadGatewayException('Scanner FTP host is not configured');

    const client = new FtpClient(this.cfg.timeoutMs);
    const folder = where.folder;

    try {
      await client.access({
        host: ftp.host,
        user: ftp.user,
        password: ftp.password,
        secure: false,
      });
      const image =
        (await this.downloadImage(client, `${folder}/${where.file}`)) ??
        (await this.newestImage(client, folder, where.file));
      if (!image) throw new Error(`No complete JPEG or BMP capture in ${folder}`);

      this.imageCache.set(key, { at: Date.now(), image });
      return image;
    } catch (err) {
      this.logger.warn(`FTP image fetch failed for ${label} (${folder}/${where.file}): ${(err as Error).message}`);
      throw new BadGatewayException(`Could not fetch image for scanner ${label}`);
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
