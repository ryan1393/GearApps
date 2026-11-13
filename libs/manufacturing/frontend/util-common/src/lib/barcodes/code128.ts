/*
 * Code 128 subset B: the one copy of the symbol table and encoder for every barcode the
 * frontend draws itself (coater packing slips and container labels, the cutter card preview).
 * Callers keep their own drawing (SVG, canvas); this module only turns text into bars.
 */

/**
 * Bar/space widths, in modules, for Code 128 symbol values 0–106. Each pattern starts with a
 * bar and alternates bar, space. 104 is Start B and 106 is Stop (with its final 2-module bar).
 */
export const CODE128_PATTERNS: readonly string[] = [
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

/** Code 128 needs at least ten modules of white either side to scan. */
export const CODE128_QUIET_ZONE_MODULES = 10;

const CODE128_START_B = 104;
const CODE128_STOP = 106;
const CODE128B_STRICT = /^[\x20-\x7e]{1,80}$/;

export interface Code128BOptions {
  /**
   * Replace each UTF-16 code unit outside ASCII 32–126 with `?` instead of throwing. Any
   * length is accepted, including empty. Without it, the value must be 1–80 printable ASCII
   * characters.
   */
  replaceUnsupported?: boolean;
}

/** Whether `value` is 1–80 printable ASCII characters, which strict encoding accepts. */
export function isCode128BEncodable(value: string): boolean {
  return CODE128B_STRICT.test(value);
}

/** Code 128 subset B symbol values for `value`: start B, the characters, check, stop. */
export function code128BSymbols(value: string, options: Code128BOptions = {}): number[] {
  let text = value;
  if (options.replaceUnsupported) {
    text = value.replace(/[^\x20-\x7e]/g, '?');
  } else if (!isCode128BEncodable(value)) {
    throw new Error(`${value || 'An empty value'} cannot be encoded as a Code 128 barcode.`);
  }
  const codes = [CODE128_START_B];
  for (let i = 0; i < text.length; i += 1) codes.push(text.charCodeAt(i) - 32);
  const check = codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
  return [...codes, check, CODE128_STOP];
}

/** The bar/space width pattern of each symbol in `value`, in order. */
export function code128BPatterns(value: string, options: Code128BOptions = {}): string[] {
  return code128BSymbols(value, options).map((symbol) => CODE128_PATTERNS[symbol]);
}

/** One bar, in modules from the left edge of the symbol including its quiet zone. */
export interface Code128Bar {
  x: number;
  width: number;
}

/** The bars of `value` laid out with quiet zones; `width` is the whole symbol in modules. */
export interface Code128Layout {
  bars: Code128Bar[];
  width: number;
}

/** Lay out `value` as bars, with `CODE128_QUIET_ZONE_MODULES` of white either side. */
export function code128BLayout(value: string, options: Code128BOptions = {}): Code128Layout {
  let x = CODE128_QUIET_ZONE_MODULES;
  const bars: Code128Bar[] = [];
  for (const pattern of code128BPatterns(value, options)) {
    for (let i = 0; i < pattern.length; i += 1) {
      const width = Number(pattern[i]);
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }
  return { bars, width: x + CODE128_QUIET_ZONE_MODULES };
}
