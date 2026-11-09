import { Socket } from 'node:net';

import {
  ContainerOrmEntity,
  LocationOrmEntity,
  TrayOrmEntity,
} from '@libs/server/data-access';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AssetTagKind, PrintAssetTagDto } from './asset-tag-print.dto';

export interface AssetTagPrintResult {
  kind: AssetTagKind;
  record_id: string;
  serial_number: string;
  language: 'IPL';
  symbology: 'CODE128';
  printed: boolean;
  printer_configured: boolean;
  file_name: string;
  prn_base64: string;
  message: string;
}

type TagAsset = TrayOrmEntity | ContainerOrmEntity | LocationOrmEntity;

@Injectable()
export class ServerFeatAssetTagService {
  private readonly logger = new Logger(ServerFeatAssetTagService.name);

  // Existing CutterLabel_FILLED.prn uses the Intermec 203 dpi coordinate family.
  // Physical stock supplied by the user:
  //   roll/web width   = 2.25 in  ~= 457 dots
  //   label width      = 2.125 in ~= 431 dots
  //   label height     = 0.625 in ~= 127 dots
  //   physical gap     = 0.125 in above + below the label
  // The printer's gap sensor/media calibration handles the physical gap. The
  // printable format itself is kept inside the 431 x 127 dot label face.
  private readonly labelWidthDots = 431;
  private readonly labelHeightDots = 127;

  constructor(
    @InjectRepository(TrayOrmEntity)
    private readonly trayRepo: Repository<TrayOrmEntity>,
    @InjectRepository(ContainerOrmEntity)
    private readonly containerRepo: Repository<ContainerOrmEntity>,
    @InjectRepository(LocationOrmEntity)
    private readonly locationRepo: Repository<LocationOrmEntity>,
  ) {}

  async printTag(dto: PrintAssetTagDto): Promise<AssetTagPrintResult> {
    const kind = dto.kind;
    const asset = await this.getAssetById(kind, dto.record_id);

    // Database truth wins. The client never supplies the printable serial.
    const serialNumber = asset.serial_number.trim().toUpperCase();
    this.assertSerialFormat(kind, serialNumber);

    const payload = this.buildIpl(serialNumber);
    const printerHost = process.env['GEAR_LABEL_PRINTER_HOST']?.trim() ?? '';
    const printerPort = this.parsePositiveInteger(
      process.env['GEAR_LABEL_PRINTER_PORT'],
      9100,
    );
    const timeoutMs = this.parsePositiveInteger(
      process.env['GEAR_LABEL_PRINTER_TIMEOUT_MS'],
      5000,
    );

    let printed = false;
    let message =
      'Printer host is not configured; the native IPL file is returned for download.';

    if (printerHost) {
      try {
        await this.sendRawIpl(printerHost, printerPort, timeoutMs, payload);
        printed = true;
        message = `${serialNumber} tag sent to the IPL printer.`;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Could not send ${serialNumber} asset tag to ${printerHost}:${printerPort}: ${reason}`,
        );
        message =
          'Printer is configured but did not accept the tag; the native IPL file is returned for download.';
      }
    }

    return {
      kind,
      record_id: dto.record_id,
      serial_number: serialNumber,
      language: 'IPL',
      symbology: 'CODE128',
      printed,
      printer_configured: Boolean(printerHost),
      file_name: `${serialNumber}.prn`,
      prn_base64: payload.toString('base64'),
      message,
    };
  }

  private assertSerialFormat(kind: AssetTagKind, serialNumber: string): void {
    if (kind === 'TRAY' && !/^T[0-9]{4,}$/.test(serialNumber)) {
      throw new BadRequestException(
        'The tray record must store a T serial with at least four digits, for example T0001.',
      );
    }

    if (kind === 'CONTAINER' && !/^C[0-9]{4,}$/.test(serialNumber)) {
      throw new BadRequestException(
        'The container record must store a C serial with at least four digits, for example C0001.',
      );
    }

    if (
      kind === 'LOCATION' &&
      !/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(serialNumber)
    ) {
      throw new BadRequestException(
        'The stored location serial contains unsupported tag characters.',
      );
    }
  }

  private async getAssetById(
    kind: AssetTagKind,
    recordId: string,
  ): Promise<TagAsset> {
    const found =
      kind === 'TRAY'
        ? await this.trayRepo.findOne({
            where: { id: recordId, enabled: true },
          })
        : kind === 'CONTAINER'
          ? await this.containerRepo.findOne({
              where: { id: recordId, enabled: true },
            })
          : await this.locationRepo.findOne({
              where: { id: recordId, enabled: true },
            });

    if (!found) {
      throw new NotFoundException(
        `${kind === 'TRAY' ? 'Tray' : kind === 'CONTAINER' ? 'Container' : 'Location'} record could not be found or is disabled.`,
      );
    }
    return found;
  }

  /**
   * Native Intermec IPL, Code 128 (c6).
   * Barcode data and human-readable text are the exact same persisted serial.
   */
  private buildIpl(serialNumber: string): Buffer {
    const STX = '\x02';
    const ETX = '\x03';
    const ESC = '\x1b';
    const SI = '\x0f';
    const CAN = '\x18';
    const ETB = '\x17';
    const FF = '\x0c';
    const formatNumber = 97;

    const barcodeNarrow = serialNumber.length <= 8 ? 2 : 1;
    const textScale =
      serialNumber.length <= 6
        ? { h: 21, w: 20, estimatedWidth: serialNumber.length * 20 }
        : serialNumber.length <= 14
          ? { h: 11, w: 10, estimatedWidth: serialNumber.length * 10 }
          : { h: 11, w: 8, estimatedWidth: serialNumber.length * 8 };
    const textAcross = Math.max(
      16,
      Math.floor((this.labelWidthDots - textScale.estimatedWidth) / 2),
    );

    const commands = [
      `${STX}R${ETX}`,
      `${STX}${ESC}C${SI}W${this.labelWidthDots}${ETX}`,
      `${STX}${ESC}P${ETX}`,
      `${STX}E${formatNumber};F${formatNumber};${ETX}`,
      `${STX}L${this.labelHeightDots};${ETX}`,
      `${STX}B0,AssetTagBarcode;o10,28;f0;h55;w${barcodeNarrow};c6;i0;d3,${serialNumber};${ETX}`,
      `${STX}H1,AssetTagText;o78,${textAcross};f0;h${textScale.h};w${textScale.w};c26;r0;b0;d3,${serialNumber};${ETX}`,
      `${STX}R${ETX}`,
      `${STX}${ESC}E${formatNumber}${ETX}`,
      `${STX}${CAN}${ETX}`,
      `${STX}${ETB}${FF}${ETX}`,
    ];

    return Buffer.from(commands.join('\r\n'), 'latin1');
  }

  private sendRawIpl(
    host: string,
    port: number,
    timeoutMs: number,
    payload: Buffer,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };

      socket.setTimeout(timeoutMs);
      socket.once('timeout', () =>
        finish(new Error(`Printer connection timed out after ${timeoutMs} ms.`)),
      );
      socket.once('error', (error) => finish(error));
      socket.connect(port, host, () => {
        socket.end(payload, () => finish());
      });
    });
  }

  private parsePositiveInteger(
    value: string | undefined,
    fallback: number,
  ): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
