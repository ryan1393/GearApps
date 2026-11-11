import { LabelPrinterService } from '@meshforge/manufacturing/server/feat-tray';
import { Injectable } from '@nestjs/common';

import { cutterCardBuildDate, moveCutterCardIpl } from './cutter-card-ipl';
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
    // Where the card lands is tuned per printer in Admin > Label Printers.
    const adjustment = { right: printer?.offset_right ?? 0, down: printer?.offset_down ?? 0 };
    const payload =
      language === 'ZPL'
        ? buildCutterCardZpl(
            {
              buildId: card.build_number,
              buildDate: cutterCardBuildDate(card.built_at),
              name: card.built_by_name,
              bodyNumber: card.cutter_body_serial_number,
              machine: card.machine_number,
              coated: card.coated,
              honed: card.honed,
              summary: card.summary_number,
              partType: card.part_type_code,
              bladeCount: card.blade_count,
              sourceTray: card.source_tray_serial_number,
              status: card.status_code,
              comments: card.comments,
            },
            adjustment,
          )
        : moveCutterCardIpl(Buffer.from(card.prn_base64, 'base64'), adjustment);

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
