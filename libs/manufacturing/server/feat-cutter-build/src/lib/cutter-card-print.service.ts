import { LabelPrinterService } from '@gearapps/manufacturing/server/feat-tray';
import { Injectable } from '@nestjs/common';

import { cutterCardBuildDate } from './cutter-card-ipl';
import { buildCutterCardZpl } from './cutter-card-zpl';
import { ServerFeatCutterBuildService } from './server-feat-cutter-build.service';

/** Sends a Cutter Build card to the card printer, in that printer's language. */
@Injectable()
export class CutterCardPrintService {
  constructor(
    private readonly builds: ServerFeatCutterBuildService,
    private readonly printers: LabelPrinterService,
  ) {}

  async print(buildNumber: string, printerId?: string) {
    const card = await this.builds.getCutterCard(buildNumber);
    const printer = await this.printers.resolve('CUTTER_CARD', printerId);
    const language = printer?.language ?? 'IPL';
    const payload =
      language === 'ZPL'
        ? buildCutterCardZpl({
            buildId: card.build_number,
            buildDate: cutterCardBuildDate(card.built_at),
            name: card.built_by_name,
            bodyNumber: card.cutter_body_serial_number,
            machine: card.machine_number,
            coated: card.coated,
            honed: card.honed,
          })
        : Buffer.from(card.prn_base64, 'base64');

    const sent = printer ? await this.printers.send(printer, payload) : null;
    return {
      build_number: card.build_number,
      language,
      printed: sent?.ok === true,
      printer_configured: Boolean(printer),
      printer_name: printer?.name ?? null,
      failure_reason: sent && !sent.ok ? sent.reason : null,
      // The same bytes, for saving when no printer took the card.
      file_name: card.prn_file_name.replace(/\.prn$/, language === 'ZPL' ? '.zpl' : '.prn'),
      file_base64: payload.toString('base64'),
      card,
    };
  }
}
