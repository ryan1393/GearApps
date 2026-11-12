import { LocationLabelInput } from './location-label';

/** What the API returns for POST /api/v1/asset-tags/location-label. */
export interface LocationLabelPrintResult {
  record_id: string;
  serial_number: string;
  language: 'IPL' | 'ZPL';
  printed: boolean;
  printer_configured: boolean;
  printer_name: string | null;
  failure_reason: string | null;
  file_name: string;
  file_base64: string;
  label: {
    serial: string;
    number?: string | null;
    summary?: string | null;
    partType?: string | null;
    description?: string | null;
    department?: string | null;
  };
}

/** A location label the card printer did not take, waiting for "Print in browser". */
export interface LocationLabelFallback {
  serial: string;
  reason: string;
  label: LocationLabelInput;
}

/** The browser label from what the API printed (database values), for the fallback. */
export function locationLabelFromResult(result: LocationLabelPrintResult): LocationLabelInput {
  const l = result.label;
  return { serial_number: l.serial, number: l.number, summary: l.summary, part_type: l.partType, description: l.description, department: l.department };
}

/** Why the card printer did not print the label, in words an operator can act on. */
export function locationLabelFallbackReason(result: LocationLabelPrintResult): string {
  if (!result.printer_configured) return 'No 4×6.5 card printer is set up.';
  return `${result.printer_name ?? 'The card printer'} did not print it: ${result.failure_reason ?? 'no answer.'}`;
}
