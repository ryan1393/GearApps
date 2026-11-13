import { readFileSync } from 'node:fs';
import { AddressInfo, createServer, Server } from 'node:net';
import { join } from 'node:path';

import { CreateTrayDto } from '@meshforge/manufacturing/server/data-access';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { buildAssetTag } from './label-printers/asset-tag-label';
import { LabelPrinterRow, LabelPrinterService } from './label-printers/label-printer.service';
import { ServerFeatAssetTagService } from './server-feat-asset-tag.service';

const SAMPLES = join(__dirname, '../../../../../../docs/manufacturing/printing/samples');
const RECORD_ID = '11111111-1111-4111-8111-111111111111';
const PRINTER_ENV = ['GEAR_LABEL_PRINTER_HOST', 'GEAR_LABEL_PRINTER_PORT', 'GEAR_LABEL_PRINTER_LANGUAGE', 'GEAR_LABEL_PRINTER_TIMEOUT_MS'] as const;

/** The printer registry over a stand-in for the Admin printer table. */
async function printerRegistry(saved: Partial<LabelPrinterRow>[] = []): Promise<LabelPrinterService> {
  const rows = saved.map((row) => ({ label_type: 'ASSET_TAG', language: 'IPL', is_default: false, enabled: true, port: 9100, offset_right: 0, offset_down: 0, ...row }));
  const query = jest.fn(async (sql: string, parameters: unknown[] = []) => {
    if (!sql.includes('SELECT')) return [];
    if (sql.includes('WHERE id = $1')) return rows.filter((row) => row.id === parameters[0] && row.label_type === parameters[1] && row.enabled);
    if (sql.includes('is_default')) return rows.filter((row) => row.label_type === parameters[0] && row.enabled && row.is_default);
    return rows;
  });
  const registry = new LabelPrinterService({
    options: { type: saved.length ? 'postgres' : 'sqlite' },
    query,
    transaction: async (work: (manager: { query: typeof query }) => Promise<unknown>) => work({ query }),
  } as never);
  await registry.onModuleInit();
  return registry;
}

async function serviceFor(serials: { tray?: string; container?: string; location?: string }, saved: Partial<LabelPrinterRow>[] = []) {
  const repo = (serial?: string) => ({
    findOne: jest.fn().mockResolvedValue(serial ? { id: RECORD_ID, serial_number: serial, enabled: true } : null),
  });
  return new ServerFeatAssetTagService(
    repo(serials.tray) as never,
    repo(serials.container) as never,
    repo(serials.location) as never,
    await printerRegistry(saved),
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
    const result = await (await serviceFor(serials)).printTag({ kind, record_id: RECORD_ID });

    expect(Buffer.from(result.prn_base64, 'base64').equals(readFileSync(join(SAMPLES, sample)))).toBe(true);
    expect(result).toMatchObject({ printed: false, printer_configured: false, file_name: sample });
  });

  it('sends the same bytes to the label printer and reports the tag as printed', async () => {
    const printer = await listen();
    process.env['GEAR_LABEL_PRINTER_HOST'] = '127.0.0.1';
    process.env['GEAR_LABEL_PRINTER_PORT'] = String(printer.port);
    try {
      const result = await (await serviceFor({ tray: 'T0001' })).printTag({ kind: 'TRAY', record_id: RECORD_ID });

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

    const result = await (await serviceFor({ container: 'C0001' })).printTag({ kind: 'CONTAINER', record_id: RECORD_ID });

    expect(result).toMatchObject({ printed: false, printer_configured: true, file_name: 'C0001.prn' });
    expect(result.prn_base64).not.toBe('');
  });

  it('prints in ZPL to the default Zebra printer set up in Admin, ahead of the environment printer', async () => {
    const zebra = await listen();
    process.env['GEAR_LABEL_PRINTER_HOST'] = '127.0.0.1';
    process.env['GEAR_LABEL_PRINTER_PORT'] = '1';
    try {
      const service = await serviceFor({ tray: 'T0001' }, [
        { id: '22222222-2222-4222-8222-222222222222', name: 'Grind Zebra', host: '127.0.0.1', port: zebra.port, language: 'ZPL', is_default: true },
      ]);
      const result = await service.printTag({ kind: 'TRAY', record_id: RECORD_ID });

      expect(result).toMatchObject({ printed: true, language: 'ZPL', printer_name: 'Grind Zebra', file_name: 'T0001.zpl' });
      expect((await zebra.received).equals(readFileSync(join(SAMPLES, 'T0001.zpl')))).toBe(true);
    } finally {
      zebra.server.close();
    }
  });

  it('prints to the printer chosen on the computer, and refuses one that is no longer set up', async () => {
    const chosen = await listen();
    try {
      const service = await serviceFor({ container: 'C0001' }, [
        { id: '22222222-2222-4222-8222-222222222222', name: 'Default', host: '127.0.0.1', port: 1, is_default: true },
        { id: '33333333-3333-4333-8333-333333333333', name: 'Dock', host: '127.0.0.1', port: chosen.port },
      ]);
      const result = await service.printTag({ kind: 'CONTAINER', record_id: RECORD_ID, printer_id: '33333333-3333-4333-8333-333333333333' });

      expect(result).toMatchObject({ printed: true, printer_name: 'Dock', language: 'IPL' });
      expect((await chosen.received).equals(readFileSync(join(SAMPLES, 'C0001.prn')))).toBe(true);
      await expect(
        service.printTag({ kind: 'CONTAINER', record_id: RECORD_ID, printer_id: '44444444-4444-4444-8444-444444444444' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      chosen.server.close();
    }
  });

  it('keeps every tag field on the 431 x 127 dot label in both languages', () => {
    for (const serial of ['T0001', 'CGDR-1.955FC', 'A'.repeat(30)]) {
      const modules = 11 * (serial.length + 2) + 13;
      const ipl = buildAssetTag('IPL', serial).toString('latin1');
      const [, barFeed, barAcross, barHeight, barDots] = /B0,AssetTagBarcode;o(\d+),(\d+);f3;h(\d+);w(\d);c6/.exec(ipl)!.map(Number);
      const [, textFeed, textAcross, textHeight, textWidth] = /H1,AssetTagText;o(\d+),(\d+);f3;h(\d+);w(\d+);c26/.exec(ipl)!.map(Number);
      // Direction-3 fields run across the web from their origin and down the feed from it.
      expect(barFeed).toBeLessThanOrEqual(127);
      expect(barFeed - barHeight).toBeGreaterThan(textFeed);
      expect(textFeed - textHeight).toBeGreaterThanOrEqual(0);
      expect(barAcross + modules * barDots).toBeLessThanOrEqual(431);
      expect(textAcross + serial.length * textWidth).toBeLessThanOrEqual(431);
      // Centred: the same room on both sides of the barcode.
      expect(Math.abs(barAcross - (431 - barAcross - modules * barDots))).toBeLessThanOrEqual(1);

      const zpl = buildAssetTag('ZPL', serial).toString('ascii');
      const [, zplDots] = /\^BY(\d),3,54/.exec(zpl)!.map(Number);
      const [, zplAcross, zplDown] = /\^FO(\d+),(\d+)\^BCN,54,N,N,N,N/.exec(zpl)!.map(Number);
      const [, textX, textY, textH, blockWidth] = /\^FO(\d+),(\d+)\^A0N,(\d+),\d+\^FB(\d+),1,0,C,0/.exec(zpl)!.map(Number);
      expect(zplAcross + modules * zplDots).toBeLessThanOrEqual(431);
      expect(textX + blockWidth).toBeLessThanOrEqual(431);
      expect(zplDown + 54).toBeLessThanOrEqual(textY);
      // On the label both for a printer that registers exactly and for the measured Zebra,
      // which prints 20 dots high: 127 dots of label start at 0 or at 20.
      for (const labelTop of [0, 20]) {
        expect(zplDown - labelTop).toBeGreaterThanOrEqual(0);
        expect(textY + textH - labelTop).toBeLessThanOrEqual(127);
      }
      expect(zpl).toContain(`^FD${serial}^FS`);
      expect(zpl).not.toContain('^LL');
      expect(zpl.startsWith('^XA')).toBe(true);
      expect(zpl.trimEnd().endsWith('^XZ')).toBe(true);
    }
  });

  it("moves the whole tag by a printer's own adjustment", () => {
    const origin = (label: string, pattern: RegExp) => pattern.exec(label)!.slice(1, 3).map(Number);
    const zplBar = /\^FO(\d+),(\d+)\^BCN/;
    const [x, y] = origin(buildAssetTag('ZPL', 'T0001').toString('ascii'), zplBar);
    expect(origin(buildAssetTag('ZPL', 'T0001', { right: 8, down: -5 }).toString('ascii'), zplBar)).toEqual([x + 8, y - 5]);

    // IPL: across is the second value; down the tag is toward the smaller feed value.
    const iplBar = /B0,AssetTagBarcode;o(\d+),(\d+);/;
    const [feed, across] = origin(buildAssetTag('IPL', 'T0001').toString('latin1'), iplBar);
    expect(origin(buildAssetTag('IPL', 'T0001', { right: 8, down: -5 }).toString('latin1'), iplBar)).toEqual([feed + 5, across + 8]);
  });

  it('sends a tag moved by the adjustment saved on the printer', async () => {
    const printer = await listen();
    try {
      const service = await serviceFor({ tray: 'T0001' }, [
        { id: '22222222-2222-4222-8222-222222222222', name: 'Nudged', host: '127.0.0.1', port: printer.port, language: 'ZPL', is_default: true, offset_right: 6, offset_down: 4 },
      ]);
      await service.printTag({ kind: 'TRAY', record_id: RECORD_ID });

      expect((await printer.received).equals(buildAssetTag('ZPL', 'T0001', { right: 6, down: 4 }))).toBe(true);
    } finally {
      printer.server.close();
    }
  });

  it('prints the stored serial, never one supplied by the caller', async () => {
    const result = await (await serviceFor({ tray: ' t0042 ' })).printTag({ kind: 'TRAY', record_id: RECORD_ID });

    expect(result.serial_number).toBe('T0042');
    expect(Buffer.from(result.prn_base64, 'base64').toString('latin1')).toContain('d3,T0042;');
  });

  it('refuses a serial whose barcode would run off the label', async () => {
    const fits = 'A'.repeat(30);
    await expect((await serviceFor({ location: fits })).printTag({ kind: 'LOCATION', record_id: RECORD_ID })).resolves.toMatchObject({ serial_number: fits });
    await expect((await serviceFor({ location: 'A'.repeat(31) })).printTag({ kind: 'LOCATION', record_id: RECORD_ID })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a tray whose stored serial is not a T serial', async () => {
    await expect((await serviceFor({ tray: 'OLD-TRAY-7' })).printTag({ kind: 'TRAY', record_id: RECORD_ID })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CreateTrayDto', () => {
  it('accepts the tray the Admin screen sends, under the API validation rules', async () => {
    const dto = plainToInstance(CreateTrayDto, { serial_number: 'T0001', blade_count: 0, enabled: true });

    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(Object.keys(dto).sort()).toEqual(['blade_count', 'enabled', 'serial_number']);
  });
  describe('location summary tag', () => {
    const locationWith = async (summary: string | null, partType: string | null) =>
      new ServerFeatAssetTagService(
        {} as never,
        {} as never,
        {
          findOne: jest.fn().mockResolvedValue({
            id: RECORD_ID,
            serial_number: 'RACK-A-03',
            enabled: true,
            summary: summary ? { number: summary } : null,
            part_type: partType ? { code: partType } : null,
          }),
        } as never,
        await printerRegistry(),
      );

    it("prints the location's Summary and part type as the barcode and text", async () => {
      const result = await (await locationWith('1.955fc', 'RING')).printTag({ kind: 'LOCATION_SUMMARY', record_id: RECORD_ID });

      expect(result).toMatchObject({ kind: 'LOCATION_SUMMARY', serial_number: '1.955FC-RING', file_name: '1.955FC-RING.prn' });
      expect(Buffer.from(result.prn_base64, 'base64')).toEqual(buildAssetTag('IPL', '1.955FC-RING'));
    });

    it('says what to set when the location has no Summary or part type', async () => {
      await expect((await locationWith(null, 'RING')).printTag({ kind: 'LOCATION_SUMMARY', record_id: RECORD_ID })).rejects.toThrow('RACK-A-03 has no Summary set');
      await expect((await locationWith('1.955FC', null)).printTag({ kind: 'LOCATION_SUMMARY', record_id: RECORD_ID })).rejects.toThrow('RACK-A-03 has no part type set');
    });

    it('refuses a Summary too long for the tag', async () => {
      await expect((await locationWith('X'.repeat(26), 'PINION')).printTag({ kind: 'LOCATION_SUMMARY', record_id: RECORD_ID })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

describe('ServerFeatAssetTagService 4 x 6.5 location label', () => {
  const location = {
    id: RECORD_ID,
    serial_number: 'gsr-1.955fc-ring',
    number: '14',
    description: 'Green Shed rough shelf',
    department: 'GREENSHED',
    enabled: true,
    summary: { number: '1.955FC' },
    part_type: { code: 'RING' },
  };
  async function labelService(saved: Partial<LabelPrinterRow>[], found: unknown = location) {
    const none = { findOne: jest.fn() };
    const locations = { findOne: jest.fn().mockResolvedValue(found) };
    return { service: new ServerFeatAssetTagService(none as never, none as never, locations as never, await printerRegistry(saved)), locations };
  }

  it('sends the landscape label to the default card printer, never to the tag printer', async () => {
    const card = await listen();
    const tag = await listen();
    try {
      const { service, locations } = await labelService([
        { id: '22222222-2222-4222-8222-222222222222', name: 'Card Zebra', host: '127.0.0.1', port: card.port, label_type: 'CUTTER_CARD', language: 'ZPL', is_default: true },
        { id: '33333333-3333-4333-8333-333333333333', name: 'Tag printer', host: '127.0.0.1', port: tag.port, label_type: 'ASSET_TAG', is_default: true },
      ]);
      const result = await service.printLocationLabel({ record_id: RECORD_ID });
      expect(locations.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: RECORD_ID, enabled: true } }));
      expect(result).toEqual(expect.objectContaining({ printed: true, printer_configured: true, printer_name: 'Card Zebra', language: 'ZPL', serial_number: 'GSR-1.955FC-RING', file_name: 'LOCATION-GSR-1.955FC-RING.zpl' }));
      const job = (await card.received).toString('utf8');
      expect(job).toMatch(/\^A0R,\d+,\d+\^FD1\.955FC\^FS/);
      expect(job).toContain('^FDRING^FS');
      expect(job).toContain('^FD14^FS');
    } finally {
      card.server.close();
      tag.server.close();
    }
  });

  it('returns the label to print from the browser when no card printer is set up', async () => {
    const { service } = await labelService([]);
    const result = await service.printLocationLabel({ record_id: RECORD_ID });
    expect(result).toEqual(expect.objectContaining({ printed: false, printer_configured: false, printer_name: null, language: 'IPL' }));
    expect(result.label).toEqual({ serial: 'GSR-1.955FC-RING', number: '14', summary: '1.955FC', partType: 'RING', description: 'Green Shed rough shelf', department: 'GREENSHED' });
    expect(Buffer.from(result.file_base64, 'base64').toString('latin1')).toContain('d3,1.955FC;');
  });

  it('refuses a location that does not exist or is disabled', async () => {
    const { service } = await labelService([], null);
    await expect(service.printLocationLabel({ record_id: RECORD_ID })).rejects.toThrow('Location record could not be found');
  });
});
