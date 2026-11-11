import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

/** What the printer is loaded with. Tags and cutter cards each have their own default printer. */
export type LabelType = 'ASSET_TAG' | 'CUTTER_CARD';
/** Intermec IPL or Zebra ZPL. */
export type LabelLanguage = 'IPL' | 'ZPL';

export interface LabelPrinterChoice {
  id: string;
  name: string;
  language: LabelLanguage;
  is_default: boolean;
}

export interface LabelPrinterChoices {
  label_type: LabelType;
  printers: LabelPrinterChoice[];
  /** The printer used when this computer has not chosen one. Null: none is set up. */
  default_printer_name: string | null;
}

const storageKey = (labelType: LabelType): string => `meshforge.label-printer.${labelType}`;

/**
 * The printer this computer prints each kind of label to. The choice is kept in the browser,
 * so a station next to its own printer keeps using it; everyone else gets the default.
 */
@Injectable({ providedIn: 'root' })
export class LabelPrinterChoiceService {
  private readonly http = inject(HttpClient);

  choices(labelType: LabelType) {
    return this.http.get<LabelPrinterChoices>('/api/v1/label-printers', { params: { label_type: labelType } });
  }

  /** Null means "use the default printer". */
  selectedId(labelType: LabelType): string | null {
    try {
      return globalThis.localStorage?.getItem(storageKey(labelType)) || null;
    } catch {
      return null;
    }
  }

  select(labelType: LabelType, printerId: string | null): void {
    try {
      if (printerId) globalThis.localStorage?.setItem(storageKey(labelType), printerId);
      else globalThis.localStorage?.removeItem(storageKey(labelType));
    } catch {
      // Private browsing or blocked storage: the default printer is used.
    }
  }
}
