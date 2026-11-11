import {
  ContainerOrmEntity,
  LocationOrmEntity,
  TrayOrmEntity,
} from '@gearapps/manufacturing/server/data-access';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AssetTagKind, PrintAssetTagDto } from './asset-tag-print.dto';
import { ASSET_TAG_MAX_SERIAL_LENGTH, assetTagFileName, buildAssetTag } from './label-printers/asset-tag-label';
import { LabelLanguage } from './label-printers/label-printer.dto';
import { LabelPrinterService } from './label-printers/label-printer.service';

export interface AssetTagPrintResult {
  kind: AssetTagKind;
  record_id: string;
  serial_number: string;
  language: LabelLanguage;
  symbology: 'CODE128';
  printed: boolean;
  printer_configured: boolean;
  /** The printer the tag was sent to, or was meant for. Null when none is set up. */
  printer_name: string | null;
  /** Why the printer did not take the tag, in words an operator can act on. */
  failure_reason: string | null;
  file_name: string;
  prn_base64: string;
  message: string;
}

type TagAsset = TrayOrmEntity | ContainerOrmEntity | LocationOrmEntity;

@Injectable()
export class ServerFeatAssetTagService {
  constructor(
    @InjectRepository(TrayOrmEntity)
    private readonly trayRepo: Repository<TrayOrmEntity>,
    @InjectRepository(ContainerOrmEntity)
    private readonly containerRepo: Repository<ContainerOrmEntity>,
    @InjectRepository(LocationOrmEntity)
    private readonly locationRepo: Repository<LocationOrmEntity>,
    private readonly printers: LabelPrinterService,
  ) {}

  async printTag(dto: PrintAssetTagDto): Promise<AssetTagPrintResult> {
    const kind = dto.kind;
    const asset = await this.getAssetById(kind, dto.record_id);

    // Database truth wins. The client never supplies the printable serial.
    const serialNumber = asset.serial_number.trim().toUpperCase();
    this.assertSerialFormat(kind, serialNumber);

    const result = await this.sendTag(serialNumber, dto.printer_id);
    return { kind, record_id: dto.record_id, serial_number: serialNumber, symbology: 'CODE128', ...result };
  }

  /** Prints a tag reading TEST so an administrator can check a printer's language and alignment. */
  async printTestTag(printerId: string) {
    return { serial_number: 'TEST', ...(await this.sendTag('TEST', printerId)) };
  }

  private async sendTag(serialNumber: string, printerId?: string) {
    const printer = await this.printers.resolve('ASSET_TAG', printerId);
    // With no printer set up the file is still offered, in the language these tags were first built in.
    const language: LabelLanguage = printer?.language ?? 'IPL';
    const payload = buildAssetTag(language, serialNumber, { right: printer?.offset_right ?? 0, down: printer?.offset_down ?? 0 });

    let printed = false;
    let failureReason: string | null = null;
    let message = 'No label printer is set up for MeshForge; the tag file is returned for download.';
    if (printer) {
      const sent = await this.printers.send(printer, payload);
      if (sent.ok) {
        printed = true;
        message = `${serialNumber} tag sent to ${printer.name}.`;
      } else {
        failureReason = sent.reason;
        message = `${printer.name} did not accept the tag; the tag file is returned for download.`;
      }
    }

    return {
      language,
      printed,
      printer_configured: Boolean(printer),
      printer_name: printer?.name ?? null,
      failure_reason: failureReason,
      file_name: assetTagFileName(serialNumber, language),
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

    if (serialNumber.length > ASSET_TAG_MAX_SERIAL_LENGTH) {
      throw new BadRequestException(
        `${serialNumber} is too long for the 2.125 in tag: the barcode would run off the label. Tags fit serials of up to ${ASSET_TAG_MAX_SERIAL_LENGTH} characters.`,
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
}
