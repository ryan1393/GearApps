import { Writable } from 'stream';
import { ScannerClientService } from './scanner-client.service';

const logins: string[] = [];
let release: (() => void) | undefined;
let fail = false;

jest.mock('basic-ftp', () => ({
  Client: class {
    async access({ host }: { host: string }) {
      logins.push(host);
    }
    async downloadTo(sink: Writable, path: string) {
      await new Promise<void>((resolve) => (release = resolve));
      if (fail) throw new Error('550 not found');
      sink.write(Buffer.from(path));
    }
    close() {
      return undefined;
    }
  },
}));

const config = {
  defaultHost: '',
  allowInsecureTls: true,
  timeoutMs: 1000,
  ftp: { host: 'ftp.plant', user: 'u', password: 'p', root: 'root', imageFile: 'img.jpg' },
};

describe('Scanner images', () => {
  beforeEach(() => {
    logins.length = 0;
    fail = false;
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });
  afterEach(() => jest.restoreAllMocks());

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('shares one FTP fetch between viewers asking at the same time', async () => {
    const service = new ScannerClientService(config as never);
    const viewers = [service.getLatestImage('10.0.0.1'), service.getLatestImage('10.0.0.1'), service.getLatestImage('10.0.0.1')];
    await settle();
    release?.();
    const images = await Promise.all(viewers);
    expect(logins).toEqual(['ftp.plant']);
    expect(images.map(String)).toEqual(Array(3).fill('root/10.0.0.1/img.jpg'));
  });

  it('serves the cached image for at least the 1 s poll period', async () => {
    expect(ScannerClientService.IMAGE_TTL_MS).toBeGreaterThanOrEqual(1000);
    const service = new ScannerClientService(config as never);
    const first = service.getLatestImage('10.0.0.1');
    await settle();
    release?.();
    await first;
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 1000);
    await service.getLatestImage('10.0.0.1');
    expect(logins).toHaveLength(1);
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + ScannerClientService.IMAGE_TTL_MS);
    const later = service.getLatestImage('10.0.0.1');
    await settle();
    release?.();
    await later;
    expect(logins).toHaveLength(2);
  });

  it('fetches each scanner on its own and does not keep a failure', async () => {
    const service = new ScannerClientService(config as never);
    fail = true;
    const failed = Promise.all([service.getLatestImage('10.0.0.2'), service.getLatestImage('10.0.0.2')]);
    await settle();
    release?.();
    await expect(failed).rejects.toThrow('Could not fetch image for scanner 10.0.0.2');
    expect(logins).toHaveLength(1);
    fail = false;
    const retry = service.getLatestImage('10.0.0.2');
    await settle();
    release?.();
    await expect(retry).resolves.toBeInstanceOf(Buffer);
    expect(logins).toHaveLength(2);
  });
});
