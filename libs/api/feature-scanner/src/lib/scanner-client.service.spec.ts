import { Client as FtpClient, FileInfo, FileType, FTPError } from 'basic-ftp';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, IncomingMessage } from 'node:http';
import { AddressInfo, createServer, Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveScannerImagePath } from '@meshforge/shared/domain';
import { ScannerClientService } from './scanner-client.service';

jest.mock('@meshforge/api/core', () => ({
  scannerConfig: { KEY: 'scanner' },
  ...jest.requireActual('../../../core/src/lib/collector/collector-network'),
}));

describe('ScannerClientService tuning commands', () => {
  let server: Server;
  let port: number;
  let reply: (command: string) => string[];
  let commands: string[];

  beforeEach(async () => {
    commands = [];
    server = createServer((socket) => {
      let command = '';
      socket.setEncoding('ascii');
      socket.on('data', (chunk: string) => {
        command += chunk;
        if (!command.endsWith('\r')) return;
        commands.push(command);
        for (const frame of reply(command)) socket.write(frame, 'ascii');
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No scanner test port');
    port = address.port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function client(timeoutMs = 1000) {
    return new ScannerClientService({
      defaultHost: '',
      allowInsecureTls: true,
      timeoutMs,
      commandPort: port,
      collectorUrl: 'http://127.0.0.1:1',
      ftp: { host: '', user: '', password: '', root: '', imageFile: '' },
    });
  }

  it('sends Tune on the configured TCP port and waits for a complete acknowledgement', async () => {
    reply = () => ['D123456789\r\nO', 'K\r'];

    await expect(client().sendCommand('127.0.0.1', { data: 'TUNE01' })).resolves.toEqual({
      data: 'OK',
    });
    expect(commands).toEqual(['TUNE01\r']);
  });

  it('reports a scanner rejection for Focus', async () => {
    reply = () => ['ER,FTUNE,02\r'];

    await expect(client().sendCommand('127.0.0.1', { data: 'FTUNE' })).rejects.toThrow(
      'ER,FTUNE,02',
    );
    expect(commands).toEqual(['FTUNE\r']);
  });

  it('reports a missing acknowledgement without sending Tune a second time', async () => {
    reply = () => [];

    await expect(client(250).sendCommand('127.0.0.1', { data: 'TUNE01' })).rejects.toThrow(
      'timed out',
    );
    expect(commands).toEqual(['TUNE01\r']);
  });
});

describe('ScannerClientService capture images', () => {
  const host = '10.16.82.253';
  const folder = `181-lapper-scanners/${host}`;
  const preferred = `${folder}/scanner-current.jpg`;
  const transferOk = { code: 226, message: 'Transfer complete' };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const bmp = Buffer.from(
    '424d3a000000000000003600000028000000010000000100000001001800000000000400000000000000000000000000000000000000ff000000',
    'hex',
  );

  function client() {
    return new ScannerClientService({
      defaultHost: '',
      allowInsecureTls: true,
      timeoutMs: 1000,
      commandPort: 9004,
      collectorUrl: 'http://127.0.0.1:1',
      ftp: {
        host: 'ftp.example.test',
        user: 'reader',
        password: 'test',
        root: '181-lapper-scanners',
        imageFile: 'scanner-current.jpg',
      },
    });
  }

  function capture(name: string, seconds: number): FileInfo {
    const file = new FileInfo(name);
    file.type = FileType.File;
    file.modifiedAt = new Date(seconds * 1000);
    return file;
  }

  beforeEach(() => {
    jest
      .spyOn(FtpClient.prototype, 'access')
      .mockResolvedValue({ code: 230, message: 'Logged in' });
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the configured JPEG and caches it without listing the folder', async () => {
    const download = jest
      .spyOn(FtpClient.prototype, 'downloadTo')
      .mockImplementation(async (sink) => {
        if (typeof sink === 'string') throw new Error('Expected an in-memory image download');
        sink.end(jpeg);
        return transferOk;
      });
    const list = jest.spyOn(FtpClient.prototype, 'list');
    const service = client();

    await expect(service.getLatestImage(host)).resolves.toEqual({
      data: jpeg,
      contentType: 'image/jpeg',
    });
    await expect(service.getLatestImage(host)).resolves.toEqual({
      data: jpeg,
      contentType: 'image/jpeg',
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0]?.[1]).toBe(preferred);
    expect(list).not.toHaveBeenCalled();
  });

  it('uses the newest complete capture for that scanner when the preferred image is missing', async () => {
    const list = jest
      .spyOn(FtpClient.prototype, 'list')
      .mockResolvedValue([
        capture('001_S_01.jpg', 10),
        capture('002_S_01.BMP', 20),
        capture('003_S_01.jpg', 30),
        capture('read-data.txt', 40),
      ]);
    const download = jest
      .spyOn(FtpClient.prototype, 'downloadTo')
      .mockImplementation(async (sink, path) => {
        if (typeof sink === 'string') throw new Error('Expected an in-memory image download');
        if (path === preferred) throw new FTPError({ code: 550, message: 'File not found' });
        sink.end(path.endsWith('.BMP') ? bmp : jpeg.subarray(0, 2));
        return transferOk;
      });

    await expect(client().getLatestImage(host)).resolves.toEqual({
      data: bmp,
      contentType: 'image/bmp',
    });
    expect(list).toHaveBeenCalledWith(folder);
    expect(download.mock.calls.map(([, path]) => path)).toEqual([
      preferred,
      `${folder}/003_S_01.jpg`,
      `${folder}/002_S_01.BMP`,
    ]);
  });
});

describe('ScannerClientService shared image fetches', () => {
  const host = '10.16.82.253';
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const transferOk = { code: 226, message: 'Transfer complete' };
  let logins: jest.SpyInstance;
  let release: () => void = () => undefined;
  let fail = false;

  function client() {
    return new ScannerClientService({
      defaultHost: '',
      allowInsecureTls: true,
      timeoutMs: 1000,
      commandPort: 9004,
      collectorUrl: 'http://127.0.0.1:1',
      ftp: { host: 'ftp.example.test', user: 'reader', password: 'test', root: 'root', imageFile: 'img.jpg' },
    });
  }
  // Each FTP download waits until the test releases it, so concurrent viewers overlap.
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  async function finish<T>(pending: Promise<T>): Promise<T> {
    await settle();
    release();
    return pending;
  }

  beforeEach(() => {
    fail = false;
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    logins = jest.spyOn(FtpClient.prototype, 'access').mockResolvedValue({ code: 230, message: 'Logged in' });
    jest.spyOn(FtpClient.prototype, 'list').mockResolvedValue([]);
    jest.spyOn(FtpClient.prototype, 'downloadTo').mockImplementation(async (sink) => {
      if (typeof sink === 'string') throw new Error('Expected an in-memory image download');
      await new Promise<void>((resolve) => (release = resolve));
      if (fail) throw new Error('connection reset');
      sink.end(jpeg);
      return transferOk;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('shares one FTP fetch between viewers asking at the same time', async () => {
    const service = client();
    const images = await finish(Promise.all([1, 2, 3].map(() => service.getLatestImage(host))));
    expect(logins).toHaveBeenCalledTimes(1);
    expect(images).toEqual(Array(3).fill({ data: jpeg, contentType: 'image/jpeg' }));
  });

  it('serves the cached image for at least the 1 s poll period', async () => {
    expect(ScannerClientService.IMAGE_TTL_MS).toBeGreaterThanOrEqual(1000);
    const service = client();
    await finish(service.getLatestImage(host));
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 1000);
    await service.getLatestImage(host);
    expect(logins).toHaveBeenCalledTimes(1);
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + ScannerClientService.IMAGE_TTL_MS);
    await finish(service.getLatestImage(host));
    expect(logins).toHaveBeenCalledTimes(2);
  });

  it('shares a failure with the viewers waiting on it but does not keep it', async () => {
    const service = client();
    fail = true;
    const failed = finish(Promise.all([service.getLatestImage(host), service.getLatestImage(host)]));
    await expect(failed).rejects.toThrow(`Could not fetch image for scanner ${host}`);
    expect(logins).toHaveBeenCalledTimes(1);
    fail = false;
    await expect(finish(service.getLatestImage(host))).resolves.toEqual({ data: jpeg, contentType: 'image/jpeg' });
    expect(logins).toHaveBeenCalledTimes(2);
  });
});

describe('ScannerClientService per-scanner image location', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const transferOk = { code: 226, message: 'Transfer complete' };
  let paths: string[];

  function client() {
    return new ScannerClientService({
      defaultHost: '',
      allowInsecureTls: true,
      timeoutMs: 1000,
      commandPort: 9004,
      collectorUrl: 'http://127.0.0.1:1',
      ftp: { host: 'ftp.example.test', user: 'reader', password: 'test', root: '181-lapper-scanners/', imageFile: 'scanner-current.jpg' },
    });
  }
  function file(name: string, type: FileType, seconds = 0): FileInfo {
    const info = new FileInfo(name);
    info.type = type;
    info.size = 10;
    info.modifiedAt = new Date(seconds * 1000);
    return info;
  }

  beforeEach(() => {
    paths = [];
    jest.spyOn(FtpClient.prototype, 'access').mockResolvedValue({ code: 230, message: 'Logged in' });
    jest.spyOn(FtpClient.prototype, 'downloadTo').mockImplementation(async (sink, path) => {
      if (typeof sink === 'string') throw new Error('Expected an in-memory image download');
      paths.push(path);
      sink.end(jpeg);
      return transferOk;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses the default <root>/<IP>/<image file> when the scanner sets nothing', async () => {
    await client().getLatestImage('10.16.82.253', { folder: null, file: '' });
    expect(paths).toEqual(['181-lapper-scanners/10.16.82.253/scanner-current.jpg']);
  });

  it("uses the scanner's own folder and file, without needing its IP", async () => {
    await client().getLatestImage(null, { folder: ' cell-4/scanner-b/ ', file: 'live.BMP' }, 'scanner-b');
    expect(paths).toEqual(['cell-4/scanner-b/live.BMP']);
  });

  it('keeps one cache entry per image location', async () => {
    const service = client();
    await service.getLatestImage('10.0.0.1', { folder: 'a' });
    await service.getLatestImage('10.0.0.1', { folder: 'b' });
    await service.getLatestImage('10.0.0.1', { folder: 'a' });
    expect(paths).toEqual(['a/scanner-current.jpg', 'b/scanner-current.jpg']);
  });

  it('refuses a scanner with neither an IP nor a folder', async () => {
    await expect(client().getLatestImage(null, {})).rejects.toThrow('IP address or its image folder');
  });

  it('lists folders and captures of a folder, newest first, defaulting to the root', async () => {
    const list = jest.spyOn(FtpClient.prototype, 'list').mockResolvedValue([
      file('10.16.82.253', FileType.Directory),
      file('old.jpg', FileType.File, 10),
      file('new.BMP', FileType.File, 20),
      file('notes.txt', FileType.File, 30),
    ]);
    const listing = await client().listFtpFolder();
    expect(list).toHaveBeenCalledWith('181-lapper-scanners');
    expect(listing.folders).toEqual(['10.16.82.253']);
    expect(listing.images.map((i) => i.name)).toEqual(['new.BMP', 'old.jpg']);
    expect(listing.defaultImageFile).toBe('scanner-current.jpg');
  });

  it("refuses folder paths with '..'", async () => {
    await expect(client().listFtpFolder('181-lapper-scanners/../secret')).rejects.toThrow("cannot contain '..'");
  });
});

describe('ScannerClientService commands through Lapper Read', () => {
  const scannerIp = '10.16.82.253';
  const tokenFile = join(mkdtempSync(join(tmpdir(), 'collector-')), 'token');
  const previous = process.env['LAPPER_READ_TOKEN_FILE'];
  let seen: { url?: string; auth?: string; body: string }[] = [];
  let answer: { status: number; body: unknown } = { status: 200, body: {} };
  const collector = createHttpServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      res.writeHead(answer.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer.body));
    });
  });
  let collectorUrl = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    collectorUrl = `http://127.0.0.1:${(collector.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => collector.close(() => resolve()));
    if (previous === undefined) delete process.env['LAPPER_READ_TOKEN_FILE'];
    else process.env['LAPPER_READ_TOKEN_FILE'] = previous;
  });
  beforeEach(() => {
    seen = [];
    writeFileSync(tokenFile, 'glr_docker\n');
    process.env['LAPPER_READ_TOKEN_FILE'] = tokenFile;
  });

  function client(commandPort = 1) {
    return new ScannerClientService({
      defaultHost: '',
      allowInsecureTls: true,
      timeoutMs: 1000,
      commandPort,
      collectorUrl,
      ftp: { host: '', user: '', password: '', root: '', imageFile: '' },
    });
  }

  it('sends Tune on the connection the collector holds, with the collector token', async () => {
    answer = { status: 200, body: { reply: 'OK,TUNE' } };

    await expect(client().sendCommand(scannerIp, { data: 'TUNE01' })).resolves.toEqual({ data: 'OK,TUNE' });
    expect(seen).toEqual([
      { url: `/scanners/${scannerIp}/command`, auth: 'Bearer glr_docker', body: JSON.stringify({ command: 'TUNE01' }) },
    ]);
  });

  it('reports a scanner rejection and a collector failure without connecting directly', async () => {
    answer = { status: 200, body: { reply: 'ER,FTUNE,02' } };
    await expect(client().sendCommand(scannerIp, { data: 'FTUNE' })).rejects.toThrow(
      `Scanner ${scannerIp} rejected the command (ER,FTUNE,02)`,
    );
    answer = { status: 502, body: { message: 'Machine 01-094-292: scanner 10.16.82.253: timed out' } };
    await expect(client().sendCommand(scannerIp, { data: 'OUTON,1' })).rejects.toThrow('timed out');
  });

  it('connects directly when the collector does not hold the scanner', async () => {
    answer = { status: 404, body: { message: 'No collector worker holds scanner 127.0.0.1.' } };
    const scanner = createServer((socket) => socket.on('data', () => socket.write('OK,TUNE\r')));
    await new Promise<void>((resolve) => scanner.listen(0, '127.0.0.1', resolve));
    try {
      const port = (scanner.address() as AddressInfo).port;
      await expect(client(port).sendCommand('127.0.0.1', { data: 'TUNE01' })).resolves.toEqual({ data: 'OK,TUNE' });
      expect(seen).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => scanner.close(() => resolve()));
    }
  });

  it('does not ask the collector without its token', async () => {
    writeFileSync(tokenFile, '');
    await expect(client().sendCommand('127.0.0.1', { data: 'TUNE01' })).rejects.toThrow('Scanner 127.0.0.1:1');
    expect(seen).toEqual([]);
  });
});

describe('Where a scanner\'s image is read (shared by the API, Scanners page and live cards)', () => {
  const defaults = { root: '181-lapper-scanners/', imageFile: 'scanner-current.jpg' };

  it('defaults to <root>/<IP>/<default file> and says so', () => {
    expect(resolveScannerImagePath({ ip: '10.16.81.235', image_folder: null, image_file: null }, defaults)).toEqual({
      folder: '181-lapper-scanners/10.16.81.235',
      file: 'scanner-current.jpg',
      defaultFolder: true,
      defaultFile: true,
    });
  });

  it("uses the scanner's own folder and file, trimmed", () => {
    expect(
      resolveScannerImagePath({ ip: '10.16.82.253', image_folder: ' 181-lapper-scanners/53711922/ ', image_file: 'a.JPG' }, defaults),
    ).toEqual({ folder: '181-lapper-scanners/53711922', file: 'a.JPG', defaultFolder: false, defaultFile: false });
  });

  it('has no folder without an IP or a folder of its own', () => {
    expect(resolveScannerImagePath({ ip: null, image_folder: '  ', image_file: null }, defaults).folder).toBeNull();
  });

  it('is the location the API reads', () => {
    const service = new ScannerClientService({
      defaultHost: '',
      allowInsecureTls: true,
      timeoutMs: 1000,
      commandPort: 9004,
      collectorUrl: 'http://127.0.0.1:1',
      ftp: { host: '', user: '', password: '', ...defaults },
    });
    expect(service.imageDefaults()).toEqual(defaults);
    expect(service.imageLocation('10.16.81.235')).toEqual({ folder: '181-lapper-scanners/10.16.81.235', file: 'scanner-current.jpg' });
    expect(() => service.imageLocation(null)).toThrow("Set the scanner's IP address or its image folder");
  });
});
