import { Client as FtpClient, FileInfo, FileType, FTPError } from 'basic-ftp';
import { createServer, Server } from 'node:net';
import { ScannerClientService } from './scanner-client.service';

jest.mock('@meshforge/api/core', () => ({ scannerConfig: { KEY: 'scanner' } }));

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
