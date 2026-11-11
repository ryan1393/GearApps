/**
 * Argonaut (Track and Trace) `trigger-transaction` request, as Lapper Read sends it at the end
 * of each lapping cycle (`apps/lapper-read-py/lapper_read/argonaut.py`). The Cycle Test Lab uses
 * the same builder to send a test transaction, so both must keep the same macros in the same order.
 */

/** floatData, in the order Argonaut expects. floatData[0], before these, is the cycle time in seconds. */
export const ARGONAUT_FLOAT_MACROS: readonly number[] = [
  10039, 10040, 10042, 10043, 10045, 10046, 10047, 10049, 10050, 10051, 10053, 10054, 10055,
  10063, 10209,
  10401, 10402, 10403, 10404, 10405, 10406, 10407, 10408, 10409, 10410, 10412, 10413, 10414,
  10415, 10416, 10418, 10419, 10421, 10426, 10428, 10430, 10433, 10435, 10437,
  10481, 10482, 10483, 10484, 10485, 10486, 10487, 10488, 10489, 10490, 10492, 10493, 10494,
  10495, 10496, 10498, 10499, 10501, 10506, 10508, 10510, 10513, 10515, 10517,
];
/** stringData, sent as whole numbers in text. #10020 is the gearset (part) number. */
export const ARGONAUT_STRING_MACROS: readonly number[] = [10020, 10021, 10023, 10400, 10480];
export const ARGONAUT_MACROS: readonly number[] = [...ARGONAUT_FLOAT_MACROS, ...ARGONAUT_STRING_MACROS];
export const ARGONAUT_DEFAULT_TRANSACTION_TYPE_ID = 100;
/**
 * The Basic sign-in the original C# Lapper Read sent on every request
 * (`Authorization: Basic dXNlcjpwdw==`). Used when no Argonaut user or password is configured;
 * keep it in step with ORIGINAL_USERNAME / ORIGINAL_PASSWORD in `lapper_read/config.py`.
 */
export const ARGONAUT_DEFAULT_USERNAME = 'user';
export const ARGONAUT_DEFAULT_PASSWORD = 'pw';

export interface ArgonautPayload {
  request: {
    sequence: number;
    transactionTypeId: number;
    serialNumber: string;
    dintData: number[];
    floatData: number[];
    stringData: string[];
    partNumber: string;
    partNumberCode: number;
  };
}

const finite = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/**
 * floatData[0]: seconds the lapper was in cycle (Y3.2 on), to the millisecond. 0 when it is
 * unknown, e.g. the collector started part-way through the cycle.
 */
export function argonautCycleTime(cycleTimeS: number | null | undefined): number {
  return typeof cycleTimeS === 'number' && Number.isFinite(cycleTimeS) && cycleTimeS > 0
    ? Math.round(cycleTimeS * 1000) / 1000
    : 0;
}

/**
 * `values` maps macro number (as text) to its value; a missing value is sent as 0, as the collector does.
 * `cycleTimeS` is sent as floatData[0] (0 when unknown).
 */
export function buildArgonautPayload(
  serial: string,
  partNumber: string | number,
  sequence: number,
  values: Record<string, number | null | undefined>,
  transactionTypeId = ARGONAUT_DEFAULT_TRANSACTION_TYPE_ID,
  cycleTimeS?: number | null,
): ArgonautPayload {
  return {
    request: {
      sequence: Math.trunc(sequence),
      transactionTypeId: Math.trunc(transactionTypeId),
      serialNumber: serial,
      dintData: [],
      floatData: [argonautCycleTime(cycleTimeS), ...ARGONAUT_FLOAT_MACROS.map((n) => finite(values[String(n)]))],
      stringData: ARGONAUT_STRING_MACROS.map((n) => String(Math.trunc(finite(values[String(n)])))),
      partNumber: String(partNumber),
      partNumberCode: 0,
    },
  };
}

/**
 * Adds `?locationId=` unless the address already carries one, which is then used exactly as
 * pasted (the collector's rule). Throws on an address that is not http(s).
 */
export function argonautAddress(url: string, locationId?: string | null): string {
  const parsed = new URL(url.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('The Argonaut address must start with http:// or https://.');
  const hasLocation = parsed.search
    .slice(1)
    .split('&')
    .some((pair) => decodeURIComponent(pair.split('=')[0].replace(/\+/g, ' ')).toLowerCase() === 'locationid');
  const location = locationId?.trim();
  if (!location || hasLocation) return url.trim();
  return url.trim() + (url.includes('?') ? '&' : '?') + new URLSearchParams({ locationId: location }).toString();
}

/**
 * Argonaut settings from Admin > Server Settings (or .env), as Lapper Read reads them from
 * GET /api/v1/lapper-read/argonaut. The sign-in is already resolved (never empty).
 */
export interface ArgonautCollectorSettings {
  url: string;
  location_id: string;
  username: string;
  password: string;
  transaction_type_id: number;
  verify_tls: boolean;
}

/** Cycle Test Lab: send one test transaction to Argonaut. */
export interface ArgonautTestInput {
  machine_id: string;
  gearset_id: string;
  serial_number: string;
  /** Sent as the request's `sequence` (a real cycle sends its consec). */
  sequence: number;
  /** Sent as floatData[0] (a real cycle sends its measured cycle time); empty sends 0. */
  cycle_time_s?: number;
  values: Record<string, number>;
  /** Overrides the machine's saved Argonaut address for this test. */
  url?: string;
  /** Overrides the machine's saved location ID for this test. */
  location_id?: string;
}

export interface ArgonautTestResult {
  /** Argonaut answered with a 2xx status. */
  ok: boolean;
  /** HTTP status, or null when Argonaut could not be reached. */
  status: number | null;
  message: string;
  /** The address the request was sent to. */
  url: string;
  /** Argonaut's reply (first 2000 characters). */
  response: string;
  payload: ArgonautPayload;
  sent_at: string;
}
