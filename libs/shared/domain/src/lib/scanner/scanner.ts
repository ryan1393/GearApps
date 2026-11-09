/** Payloads exchanged with the Keyence-style scanner HTTP API. */
export interface ScannerCommand {
  data: string;
}

export interface ScannerBank {
  ok: number[];
  err: number[];
  unuse: number[];
}

export interface ScannerCounter {
  ok: number;
  ng: number;
  err: number;
  unstable: number;
  trg: number;
  trglost: number;
}

export interface ScannerLatestLogText {
  id: string;
  triggertime: string;
  result: string;
  readdata: string;
  readtime: string;
}

export interface ScannerLatestLogData {
  id: number;
  triggertime: number;
  result: string;
  readdata: string;
  readtime: number;
}

export interface ScannerSummary {
  liveimage: string;
  bank: ScannerBank;
  counter: ScannerCounter;
  latestlog: [ScannerLatestLogText, ScannerLatestLogData][];
  codevertex: number[][][];
}

export interface ScannerLogEntry {
  timestamp: Date | string;
  type: string;
  data: string;
}

export interface ScannerLog {
  event_object: ScannerLogEntry[];
}
