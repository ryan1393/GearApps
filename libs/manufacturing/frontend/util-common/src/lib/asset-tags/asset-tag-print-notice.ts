import { DanaToastService } from '@dana/ui';

/** The part of the print response the operator needs to hear about. */
export interface AssetTagPrintOutcome {
  printed: boolean;
  printer_configured: boolean;
  serial_number: string;
  file_name: string;
  /** The printer the tag went to, or was meant for. */
  printer_name?: string | null;
  /** What to check, when the printer did not take the tag. */
  failure_reason?: string | null;
}

export interface AssetTagPrintNotice {
  tone: 'success' | 'warning' | 'info';
  title: string;
  text: string;
}

/**
 * One wording for every Print Tag button. A tag that only reached a downloaded file is never
 * reported as printed, and a printer that did not answer is a warning, not a success.
 */
export function assetTagPrintNotice(result: AssetTagPrintOutcome): AssetTagPrintNotice {
  if (result.printed) {
    return { tone: 'success', title: 'Tag sent to printer', text: `${result.serial_number} tag sent to ${result.printer_name || 'the label printer'}.` };
  }
  if (result.printer_configured) {
    return {
      tone: 'warning',
      title: `${result.printer_name || 'Label printer'} did not print`,
      text: `The ${result.serial_number} tag was not printed. ${result.failure_reason || 'Check that the label printer is on and connected.'} ${result.file_name} was downloaded as a backup.`,
    };
  }
  return {
    tone: 'info',
    title: 'Tag file downloaded',
    text: `No tag printer is set up, so ${result.file_name} was downloaded. An administrator can add a printer in Admin › Label Printers.`,
  };
}

/** Shows the outcome where the operator is looking, however far down a list the button was. */
export function announceAssetTagPrint(toast: DanaToastService, result: AssetTagPrintOutcome): AssetTagPrintNotice {
  const notice = assetTagPrintNotice(result);
  toast[notice.tone](notice.text, notice.title);
  return notice;
}
