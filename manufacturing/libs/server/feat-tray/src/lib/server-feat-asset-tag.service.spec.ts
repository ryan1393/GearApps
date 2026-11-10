import { readFileSync } from 'node:fs';
import { AddressInfo, createServer, Server } from 'node:net';
import { join } from 'node:path';

import { CreateTrayDto } from '@gearapps/manufacturing/server/data-access';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ServerFeatAssetTagService } from './server-feat-asset-tag.service';

const SAMPLES = join(__dirname, '../../../../../docs/printing/samples');
const RECORD_ID = '11111111-1111-4111-8111-111111111111';
const PRINTER_ENV = ['GEAR_LABEL_PRINTER_HOST', 'GEAR_LABEL_PRINTER_PORT', 'GEAR_LABEL_PRINTER_TIMEOUT_MS'] as const;

function serviceFor(serials: { tray?: string; container?: string; location?: string }) {
  const repo = (serial?: string) => ({
    findOne: jest.fn().mockResolvedValue(serial ? { id: RECORD_ID, serial_number: serial, enabled: true } : null),
  });
  return new ServerFeatAssetTagService(
    repo(serials.tray) as never,
    repo(serials.container) as never,
    repo(serials.location) as never,
  );
}

/** Stands in for the label printer: a raw TCP port that keeps what it is sent. */
function listen(): Promise<{ server: Server; port: number; received: Promise<Buffer> }> {
  return new Promise((resolve) => {
    let done: (job: Buffer) => void;
    const received = new Promise<Buffer>((r) => (done = r));
    const server = createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('close', () => done(Buffer.concat(chunks)));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, received }));
  });
}

describe('ServerFeatAssetTagService', () => {
  const saved = PRINTER_ENV.map((name) => [name, process.env[name]] as const);
  beforeEach(() => PRINTER_ENV.forEach((name) => delete process.env[name]));
  afterAll(() => saved.forEach(([name, value]) => (value === undefined ? delete process.env[name] : (process.env[name] = value))));

  it.each([
    ['TRAY', { tray: 'T0001' }, 'T0001.prn'],
    ['CONTAINER', { container: 'C0001' }, 'C0001.prn'],
    ['LOCATION', { location: 'CGDR-1.955FC' }, 'CGDR-1.955FC.prn'],
  ] as const)('builds the %s tag exactly as the reference sample', async (kind, serials, sample) => {
    const result = await serviceFor(serials).printTag({ kind, record_id: RECORD_ID });

    expect(Buffer.from(result.prn_base64, 'base64').equals(readFileSync(join(SAMPLES, sample)))).toBe(true);
    expect(result).toMatchObject({ printed: false, printer_configured: false, file_name: sample });
  });

  it('sends the same bytes to the label printer and reports the tag as printed', async () => {
    const printer = await listen();
    process.env['GEAR_LABEL_PRINTER_HOST'] = '127.0.0.1';
    process.env['GEAR_LABEL_PRINTER_PORT'] = String(printer.port);
    try {
      const result = await serviceFor({ tray: 'T0001' }).printTag({ kind: 'TRAY', record_id: RECORD_ID });

      expect(result).toMatchObject({ printed: true, printer_configured: true });
      expect((await printer.received).equals(readFileSync(join(SAMPLES, 'T0001.prn')))).toBe(true);
    } finally {
      printer.server.close();
    }
  });

  it('returns the tag file and does not claim a print when the printer cannot be reached', async () => {
    const printer = await listen();
    const closedPort = printer.port;
    await new Promise((resolve) => printer.server.close(resolve));
    process.env['GEAR_LABEL_PRINTER_HOST'] = '127.0.0.1';
    process.env['GEAR_LABEL_PRINTER_PORT'] = String(closedPort);
    process.env['GEAR_LABEL_PRINTER_TIMEOUT_MS'] = '1000';

    const result = await serviceFor({ container: 'C0001' }).printTag({ kind: 'CONTAINER', record_id: RECORD_ID });

    expect(result).toMatchObject({ printed: false, printer_configured: true, file_name: 'C0001.prn' });
    expect(result.prn_base64).not.toBe('');
  });

  it('prints the stored serial, never one supplied by the caller', async () => {
    const result = await serviceFor({ tray: ' t0042 ' }).printTag({ kind: 'TRAY', record_id: RECORD_ID });

    expect(result.serial_number).toBe('T0042');
    expect(Buffer.from(result.prn_base64, 'base64').toString('latin1')).toContain('d3,T0042;');
  });

  it('refuses a serial whose barcode would run off the label', async () => {
    const fits = 'A'.repeat(32);
    await expect(serviceFor({ location: fits }).printTag({ kind: 'LOCATION', record_id: RECORD_ID })).resolves.toMatchObject({ serial_number: fits });
    await expect(serviceFor({ location: 'A'.repeat(33) }).printTag({ kind: 'LOCATION', record_id: RECORD_ID })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a tray whose stored serial is not a T serial', async () => {
    await expect(serviceFor({ tray: 'OLD-TRAY-7' }).printTag({ kind: 'TRAY', record_id: RECORD_ID })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CreateTrayDto', () => {
  it('accepts the tray the Admin screen sends, under the API validation rules', async () => {
    const dto = plainToInstance(CreateTrayDto, { serial_number: 'T0001', blade_count: 0, enabled: true });

    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(Object.keys(dto).sort()).toEqual(['blade_count', 'enabled', 'serial_number']);
  });
});
