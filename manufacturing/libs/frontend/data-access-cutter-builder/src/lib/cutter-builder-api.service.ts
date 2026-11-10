import { defer, EMPTY, expand, map, Observable, reduce } from 'rxjs';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { LabelPrinterChoiceService } from '@gearapps/manufacturing/frontend/util-common';
import { ILocation, IPaginatedResponse, ITray } from '@gearapps/manufacturing/shared/util-types';

export interface CutterBody {
  id: string;
  dana_serial_number: string | null;
  mf_serial_number: string | null;
  description: string | null;
  definition_id: string | null;
  definition?: {
    definition_code: string;
    supplier_name: string;
    hand_name: string;
    blade_family_name: string;
    size_description: string | null;
  } | null;
  enabled: boolean;
}

export interface CutterBuilderMachine {
  id: string;
  machine_number: string;
  department_id: string;
  machine_type: string;
  cell: number | null;
  description: string | null;
  active: boolean;
  enabled: boolean;
  department?: { code: string; description: string | null; active: boolean; enabled: boolean } | null;
}

export interface CutterBuildCard {
  cutter_build_id: string;
  build_number: string;
  build_increment: number;
  cutter_body_serial_number: string;
  summary_id: string;
  summary_number: string;
  summary_model: string;
  part_type_id: string;
  part_type_code: 'RING' | 'PINION' | string;
  blade_count: number;
  source_tray_serial_number: string;
  honed: boolean;
  coated: boolean;
  ib_ro: number | null;
  ob_ro: number | null;
  comments: string | null;
  built_at: string;
  built_by_user_id: string | null;
  status_code: string;
  built_by_name?: string;
  cutter_builder_machine_id?: string | null;
  cutter_builder_machine_number?: string | null;
  machine_number?: string;
  prn_file_name?: string;
  png_file_name?: string;
  prn_base64?: string;
}

export interface CutterBuildResult {
  build: CutterBuildCard;
  blade_ids: string[];
  tray_released: boolean;
}

/** What happened when a cutter card was sent to the card printer. */
export interface CutterCardPrintResult {
  build_number: string;
  language: 'IPL' | 'ZPL';
  printed: boolean;
  printer_configured: boolean;
  printer_name: string | null;
  failure_reason: string | null;
  /** The card in the printer's language, for saving when no printer took it. */
  file_name: string;
  file_base64: string;
  card: CutterBuildCard;
}

export interface CutterTeardownResult {
  teardown_id: string;
  build_number: string;
  cutter_body_serial_number: string;
  teardown_tray_serial_number: string;
  shelf_location_serial_number: string | null;
  original_blade_count: number;
  returned_blade_count: number;
  scrapped_blade_count: number;
  build_closed: boolean;
  tray_waiting_for_grinding: boolean;
  tray_available_for_use: boolean;
  torn_down_at: string;
}

export interface CutterBuildDetails {
  id: string;
  build_number: string;
  build_increment: number;
  status?: { code: string; name: string };
  cutter_body?: CutterBody;
  summary?: { id: string; number: string; model: string };
  part_type?: { id: string; code: string; name: string };
  built_at: string;
  completed_at?: string | null;
  honed: boolean;
  coated: boolean;
  ib_ro?: number | null;
  ob_ro?: number | null;
  comments?: string | null;
  cutter_builder_machine_id?: string | null;
  cutter_builder_machine?: CutterBuilderMachine | null;
}


export interface CutterDashboardData {
  counts: {
    builds_in_progress: number;
    ready_to_run: number;
    on_shelf: number;
    under_teardown: number;
    waiting_for_grinding: number;
    ready_for_cutter_shelf: number;
  };
  recent_builds: Array<{
    build_number: string;
    cutter_body_serial_number: string;
    summary_number: string;
    part_type_code: string;
    status_code: string;
    built_at: string;
  }>;
  recent_teardowns: Array<{
    build_number: string;
    cutter_body_serial_number: string;
    original_blade_count: number;
    returned_blade_count: number;
    scrapped_blade_count: number;
    teardown_tray_serial_number: string;
    torn_down_at: string;
  }>;
  waiting_for_grinding: Array<{
    tray_id: string;
    tray_serial_number: string;
    shelf_location: string;
    shelf_description: string | null;
    summary_number: string | null;
    part_type_code: string | null;
    blade_count: number;
  }>;
  pulled_builds: Array<{
    build_number: string;
    cutter_body_serial_number: string;
    summary_number: string;
    part_type_code: string;
    pull_reason_code: string | null;
    pull_reason_name: string | null;
    pulled_at: string;
    machine_number: string | null;
    final_piece_count: number;
  }>;
  ready_for_cutter: Array<{
    tray_id: string;
    tray_serial_number: string;
    shelf_location: string;
    shelf_description: string | null;
    summary_number: string | null;
    part_type_code: string | null;
    blade_count: number;
    required_blade_count: number | null;
  }>;
}

export interface CutterBuildSearchRow {
  id: string;
  build_number: string;
  build_increment: number;
  cutter_body_serial_number: string;
  summary_number: string;
  summary_model: string;
  part_type_code: string;
  status_code: string;
  built_at: string;
  completed_at: string | null;
}

export interface CutterTrayValidation {
  valid: boolean;
  tray_id: string;
  tray_serial_number: string;
  grinding_complete: boolean;
  required_blade_count: number;
  tray_declared_blade_count: number;
  active_blade_count: number;
  requirement_id: string;
  summary_matches: boolean;
  part_type_matches: boolean;
  blade_identity_matches: boolean;
  blades_ready_for_cutter: boolean;
  already_assigned_to_build: boolean;
  still_in_container: boolean;
  tray_stage_ready: boolean;
  reason?: string;
}

@Injectable({ providedIn: 'root' })
export class CutterBuilderApiService {
  private readonly http = inject(HttpClient);
  private readonly printerChoice = inject(LabelPrinterChoiceService);


  startGrinding(trayId: string) {
    return this.http.post(
      `/api/v1/trays/${encodeURIComponent(trayId)}/start-grinding`,
      {},
    );
  }

  getDashboard() {
    return this.http.get<CutterDashboardData>('/api/v1/cutter-builder/dashboard');
  }

  listCutterBuilderMachines() {
    return this.http.get<CutterBuilderMachine[]>('/api/v1/cutter-builder/machines');
  }

  searchBuilds(filters?: {
    q?: string;
    status?: string;
    partType?: string;
    cutterBody?: string;
    limit?: number;
  }) {
    const params: Record<string, string> = {};
    if (filters?.q?.trim()) params['q'] = filters.q.trim();
    if (filters?.status?.trim()) params['status'] = filters.status.trim();
    if (filters?.partType?.trim()) params['partType'] = filters.partType.trim();
    if (filters?.cutterBody?.trim()) params['cutterBody'] = filters.cutterBody.trim();
    if (filters?.limit) params['limit'] = String(filters.limit);

    return this.http.get<CutterBuildSearchRow[]>('/api/v1/cutter-builder/builds', {
      params,
    });
  }

  validateTray(tray: ITray) {
    if (!tray.summary_id || !tray.part_type_id) {
      throw new Error('Tray is missing Summary or Part Type.');
    }

    return this.http.post<CutterTrayValidation>(
      '/api/v1/cutter-config/validate-tray',
      {
        summary_id: tray.summary_id,
        part_type_id: tray.part_type_id,
        tray_serial_number: tray.serial_number,
      },
    );
  }

  /**
   * Looks up by Dana S/N (normal scan path) or MF S/N (manual fallback).
   */
  listCutterBodies() {
    return this.http.get<CutterBody[]>('/api/v1/cutter-builder/cutter-bodies');
  }

  /** Follow server metadata; large requested page sizes are clamped by the API. */
  private allPages<T extends { id: string }>(endpoint: string): Observable<T[]> {
    return defer(() => {
      let expectedPage = 1;
      const load = () => this.http.get<IPaginatedResponse<T>>(endpoint, {
        params: { page: String(expectedPage), perPage: '50' },
      });
      return load().pipe(
        expand(result => {
          if (Number(result.meta?.page) !== expectedPage || !Array.isArray(result.data)) {
            throw new Error('Inventory pagination changed unexpectedly. Refresh the picker.');
          }
          if (!result.meta.hasNextPage) return EMPTY;
          if (!result.data.length || expectedPage >= 10000) throw new Error('Inventory pagination did not advance.');
          expectedPage += 1;
          return load();
        }),
        reduce((rows, page) => {
          for (const item of page.data) rows.set(item.id, item);
          return rows;
        }, new Map<string, T>()),
        map(rows => [...rows.values()]),
      );
    });
  }

  getSelectionTrays() { return this.allPages<ITray>('/api/v1/trays'); }
  getSelectionLocations() { return this.allPages<ILocation>('/api/v1/locations'); }

  scanCutterBody(serialNumber: string) {
    return this.http.get<CutterBody>(
      `/api/v1/cutter-builder/cutter-bodies/scan/${encodeURIComponent(serialNumber.trim())}`,
    );
  }

  scanLocation(serialNumber: string) {
    return this.http.get<ILocation>(
      `/api/v1/locations/scan/${encodeURIComponent(serialNumber.trim())}`,
    );
  }

  scanTray(serialNumber: string) {
    return this.http.get<ITray>(
      `/api/v1/trays/scan/${encodeURIComponent(serialNumber.trim())}`,
    );
  }

  createBuild(input: {
    cutterBodyIdentifier: string;
    traySerial: string;
    cutterBuilderMachineId: string;
    honed: boolean;
    coated: boolean;
    ibRo?: number | null;
    obRo?: number | null;
    comments?: string | null;
  }) {
    return this.http.post<CutterBuildResult>('/api/v1/cutter-builder/builds', {
      cutter_body_identifier: input.cutterBodyIdentifier,
      tray_serial_number: input.traySerial,
      cutter_builder_machine_id: input.cutterBuilderMachineId,
      honed: input.honed,
      coated: input.coated,
      ib_ro: input.ibRo ?? null,
      ob_ro: input.obRo ?? null,
      comments: input.comments?.trim() || null,
    });
  }

  teardownBuild(input: {
    buildNumber: string;
    teardownTraySerial: string;
    scrappedBladeCount: number;
    shelfLocationSerial?: string | null;
    comments?: string | null;
  }) {
    return this.http.post<CutterTeardownResult>('/api/v1/cutter-builder/teardowns', {
      build_number: input.buildNumber,
      teardown_tray_serial_number: input.teardownTraySerial,
      scrapped_blade_count: input.scrappedBladeCount,
      shelf_location_serial_number: input.shelfLocationSerial?.trim() || null,
      comments: input.comments?.trim() || null,
    });
  }

  getBuild(buildNumber: string) {
    return this.http.get<CutterBuildDetails>(
      `/api/v1/cutter-builder/builds/${encodeURIComponent(buildNumber.trim())}`,
    );
  }

  /** Sends the card to the card printer chosen on this computer, or the default one. */
  printCard(buildNumber: string) {
    return this.http.post<CutterCardPrintResult>(
      `/api/v1/cutter-builder/builds/${encodeURIComponent(buildNumber.trim())}/card/print`,
      { printer_id: this.printerChoice.selectedId('CUTTER_CARD') ?? undefined },
    );
  }

  getCard(buildNumber: string) {
    return this.http.get<CutterBuildCard>(
      `/api/v1/cutter-builder/builds/${encodeURIComponent(buildNumber.trim())}/card`,
    );
  }

  getTeardown(buildNumber: string) {
    return this.http.get(
      `/api/v1/cutter-builder/teardowns/${encodeURIComponent(buildNumber.trim())}`,
    );
  }
}

export function cutterApiErrorText(
  error: HttpErrorResponse,
  fallback: string,
): string {
  const message = error.error?.message;
  return Array.isArray(message) ? message.join(', ') : message || fallback;
}


const CUTTER_CARD_CODE128_PATTERNS: readonly string[] = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212',
  '112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131',
  '311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321',
  '112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121',
  '313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114',
  '122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212',
  '124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113',
  '114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112',
];

function cutterCardFileStem(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]/g, '_') || 'cutter-card';
}

function base64Blob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function code128BPatterns(value: string): string[] {
  const text = value
    .split('')
    .map((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code <= 126 ? character : '?';
    })
    .join('');
  const codes = [104, ...text.split('').map((character) => character.charCodeAt(0) - 32)];
  let checksum = 104;
  for (let i = 1; i < codes.length; i += 1) checksum += codes[i] * i;
  codes.push(checksum % 103, 106);
  return codes.map((code) => CUTTER_CARD_CODE128_PATTERNS[code]);
}

function drawCode128(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const patterns = code128BPatterns(text);
  const moduleCount = patterns.reduce(
    (total, pattern) => total + pattern.split('').reduce((sum, digit) => sum + Number(digit), 0),
    20,
  );
  // Whole-pixel bars keep the preview scannable; only a number too long for that is scaled to fit.
  const wholePixels = Math.floor(width / moduleCount);
  const moduleWidth = wholePixels >= 1 ? wholePixels : width / moduleCount;
  let cursor = x + Math.floor((width - moduleWidth * moduleCount) / 2) + moduleWidth * 10;
  context.fillStyle = '#000000';
  for (const pattern of patterns) {
    let bar = true;
    for (const digit of pattern) {
      const segment = Number(digit) * moduleWidth;
      if (bar) context.fillRect(cursor, y, Math.max(1, segment), height);
      cursor += segment;
      bar = !bar;
    }
  }
}

function cutterCardPreviewField(
  context: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
): void {
  context.fillStyle = '#475569';
  context.font = '700 22px Arial, sans-serif';
  context.fillText(label.toUpperCase(), x, y);
  context.fillStyle = '#0f172a';
  context.font = '700 34px Arial, sans-serif';
  let display = value || '—';
  if (context.measureText(display).width > width) {
    while (display.length > 1 && context.measureText(display + '…').width > width) display = display.slice(0, -1);
    display += '…';
  }
  context.fillText(display, x, y + 42);
}

function cutterCardPng(card: CutterBuildCard): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 816;
  canvas.height = 1320;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('This browser could not create the Cutter Card PNG preview.'));

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#0f172a';
  context.lineWidth = 5;
  context.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);

  context.fillStyle = '#0f172a';
  context.font = '900 38px Arial, sans-serif';
  context.fillText('GEAR APPS', 55, 78);
  context.font = '900 50px Arial, sans-serif';
  context.fillText('CUTTER BUILD CARD', 55, 140);

  drawCode128(context, card.build_number, 55, 190, 706, 145);
  let numberSize = 36;
  context.font = `900 ${numberSize}px Consolas, monospace`;
  while (numberSize > 14 && context.measureText(card.build_number).width > 706) {
    numberSize -= 2;
    context.font = `900 ${numberSize}px Consolas, monospace`;
  }
  context.textAlign = 'center';
  context.fillText(card.build_number, canvas.width / 2, 385);
  context.textAlign = 'left';

  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(55, 425);
  context.lineTo(761, 425);
  context.stroke();

  cutterCardPreviewField(context, 'Cutter Body', card.cutter_body_serial_number, 55, 475, 320);
  cutterCardPreviewField(context, 'Summary', card.summary_number, 430, 475, 330);
  cutterCardPreviewField(context, 'Part Type', card.part_type_code, 55, 585, 320);
  cutterCardPreviewField(context, 'Blade Qty', String(card.blade_count), 430, 585, 330);
  cutterCardPreviewField(context, 'Source Tray', card.source_tray_serial_number, 55, 695, 320);
  cutterCardPreviewField(context, 'Status', card.status_code, 430, 695, 330);
  cutterCardPreviewField(context, 'Built By', card.built_by_name || '', 55, 805, 320);
  cutterCardPreviewField(context, 'Machine', card.machine_number || '', 430, 805, 330);
  cutterCardPreviewField(context, 'Honed', card.honed ? 'YES' : 'NO', 55, 915, 320);
  cutterCardPreviewField(context, 'Coated', card.coated ? 'YES' : 'NO', 430, 915, 330);

  context.fillStyle = '#475569';
  context.font = '700 22px Arial, sans-serif';
  context.fillText('BUILT ON', 55, 1025);
  context.fillStyle = '#0f172a';
  context.font = '700 30px Arial, sans-serif';
  const builtAt = new Date(card.built_at);
  context.fillText(
    // Plant time, the same as the date on the printed card, whatever this computer's clock zone is.
    Number.isNaN(builtAt.getTime())
      ? card.built_at
      : new Intl.DateTimeFormat('en-US', { timeZone: 'America/Indiana/Indianapolis', dateStyle: 'medium', timeStyle: 'short' }).format(builtAt),
    55,
    1067,
  );

  context.fillStyle = '#475569';
  context.font = '700 22px Arial, sans-serif';
  context.fillText('COMMENTS', 55, 1135);
  context.fillStyle = '#0f172a';
  context.font = '24px Arial, sans-serif';
  const comments = (card.comments || '—').slice(0, 105);
  const first = comments.slice(0, 52);
  const second = comments.slice(52);
  context.fillText(first, 55, 1175);
  if (second) context.fillText(second, 55, 1210);

  context.fillStyle = '#64748b';
  context.font = '18px Arial, sans-serif';
  context.fillText('PNG PREVIEW — native IPL .prn is the printer-authoritative file', 55, 1260);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode the Cutter Card PNG preview.'));
    }, 'image/png');
  });
}

/**
 * Saves the card as a printer file plus a PNG preview. `printerFile` is the card in the language
 * of the printer it was meant for; without it the IPL file is saved.
 */
export async function downloadCutterCardArtifacts(
  card: CutterBuildCard,
  printerFile?: { file_name: string; file_base64: string },
): Promise<{ prnFileName: string; pngFileName: string }> {
  if (printerFile) card = { ...card, prn_base64: printerFile.file_base64, prn_file_name: printerFile.file_name };
  if (!card.prn_base64) {
    throw new Error('The Gear Apps API did not return a native Cutter Card PRN. Restart the API after installing the cutter-card export patch.');
  }
  const stem = cutterCardFileStem(card.build_number);
  const prnFileName = card.prn_file_name || `${stem}.prn`;
  const pngFileName = card.png_file_name || `${stem}.png`;

  downloadBlob(base64Blob(card.prn_base64, 'application/octet-stream'), prnFileName);
  const png = await cutterCardPng(card);
  window.setTimeout(() => downloadBlob(png, pngFileName), 120);
  return { prnFileName, pngFileName };
}
