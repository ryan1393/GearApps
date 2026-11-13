import { inflateRawSync, inflateSync } from 'node:zlib';

/*
 * Bounded PDF stream decoding for packing-slip extraction: locate stream
 * objects, resolve their filters (Flate, ASCII85, ASCIIHex) and keep only the
 * streams that carry text operators or CMaps. Limits cap stream count and
 * expanded size so a hostile PDF cannot exhaust memory.
 */

const MAX_STREAM_COUNT = 500;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_FILTER_COUNT = 8;

function budgetExceeded(): never {
  throw new Error('The packing-slip PDF exceeds the safe decoding limit. Upload a smaller PDF.');
}

function assertBudget(size: number, remaining: number) {
  if (size > remaining) budgetExceeded();
}

type DecodeBudget = { remaining: number };
function chargeBudget(size: number, budget: DecodeBudget) {
  assertBudget(size, budget.remaining);
  budget.remaining -= size;
}

function trimPdfStream(buffer: Buffer) {
  // Remove only the final separator EOL byte. A preceding CR, space or tab may
  // be compressed payload (even when the separator is LF). Leaving the CR of a
  // CRLF separator is harmless trailing input to zlib and the ASCII decoders.
  const last = buffer[buffer.length - 1];
  return last === 0x0a || last === 0x0d ? buffer.subarray(0, -1) : buffer;
}

function hasZlibHeader(buffer: Buffer): boolean {
  if (buffer.length < 2) return false;
  const cmf = buffer[0], flg = buffer[1];
  return (cmf & 0x0f) === 8 && (cmf >>> 4) <= 7 && ((cmf << 8) + flg) % 31 === 0;
}

function decodeAscii85(source: Buffer, remaining: number) {
  const raw = source.toString('ascii');
  const startMarker = raw.indexOf('<~');
  const endMarker = raw.lastIndexOf('~>');
  const body = raw
    .slice(startMarker >= 0 ? startMarker + 2 : 0, endMarker >= 0 ? endMarker : raw.length)
    .replace(/[\t\n\f\r ]+/g, '');
  const output = Buffer.allocUnsafe(Math.min(remaining, body.length * 4));
  let outputLength = 0;
  let group: number[] = [];

  const flush = (final = false) => {
    if (!group.length) return true;
    const originalLength = group.length;
    if (final && originalLength > 1) {
      while (group.length < 5) group.push(84);
    }
    if (group.length !== 5) return false;
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    if (value > 0xffffffff) return false;
    const bytes = [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
    const count = final ? originalLength - 1 : 4;
    assertBudget(outputLength + count, remaining);
    for (let index = 0; index < count; index++) output[outputLength++] = bytes[index];
    group = [];
    return true;
  };

  for (let index = 0; index < body.length; index += 1) {
    const char = body.charCodeAt(index);
    if (char === 0x7a) {
      if (group.length) return null;
      assertBudget(outputLength + 4, remaining);
      output.fill(0, outputLength, outputLength + 4);
      outputLength += 4;
      continue;
    }
    if (char < 0x21 || char > 0x75) return null;
    group.push(char - 0x21);
    if (group.length === 5 && !flush()) return null;
  }
  if (group.length === 1) return null;
  if (group.length > 1 && !flush(true)) return null;
  return output.subarray(0, outputLength);
}

function decodeAsciiHex(source: Buffer, remaining: number) {
  let hex = source.toString('ascii').replace(/[\t\n\f\r ]+/g, '').replace(/>.*$/, '');
  if (!/^[0-9A-Fa-f]*$/.test(hex)) return null;
  assertBudget(Math.ceil(hex.length / 2), remaining);
  if (hex.length % 2) hex += '0';
  return Buffer.from(hex, 'hex');
}

function directPdfStreamFilters(source: string) {
  const arrayMatch = source.match(/\/Filter\s*\[([\s\S]*?)\]/);
  if (arrayMatch) {
    return [...arrayMatch[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((match) => match[1]);
  }
  const single = source.match(/\/Filter\s*\/([A-Za-z0-9]+)/);
  return single ? [single[1]] : [];
}

function currentObjectDictionary(raw: string, streamIndex: number) {
  const start = Math.max(0, streamIndex - 8_192);
  const prefix = raw.slice(start, streamIndex);
  const objectMatches = [...prefix.matchAll(/(?:^|[\r\n])\s*\d+\s+\d+\s+obj\b/g)];
  const objectBody = objectMatches.length
    ? prefix.slice((objectMatches[objectMatches.length - 1].index ?? 0) + objectMatches[objectMatches.length - 1][0].length)
    : prefix;
  const dictionaryStart = objectBody.lastIndexOf('<<');
  return dictionaryStart >= 0 ? objectBody.slice(dictionaryStart) : objectBody;
}

function indirectPdfObject(raw: string, objectNumber: string, generation: string) {
  const pattern = new RegExp(
    `(?:^|[\r\n])\\s*${objectNumber}\\s+${generation}\\s+obj\\b`,
    'g',
  );
  const match = pattern.exec(raw);
  if (!match) return null;
  const bodyStart = (match.index ?? 0) + match[0].length;
  const bodyEnd = raw.indexOf('endobj', bodyStart);
  return bodyEnd >= 0 ? raw.slice(bodyStart, bodyEnd) : null;
}

function pdfStreamFilters(dictionary: string, raw: string) {
  const direct = directPdfStreamFilters(dictionary);
  if (direct.length) return direct;

  const indirect = dictionary.match(/\/Filter\s+(\d+)\s+(\d+)\s+R\b/);
  if (!indirect) return [];
  const objectBody = indirectPdfObject(raw, indirect[1], indirect[2]);
  return objectBody ? directPdfStreamFilters(`/Filter ${objectBody}`) : [];
}

function applyPdfStreamFilters(streamBytes: Buffer, filters: string[], budget: DecodeBudget) {
  if (filters.length > MAX_FILTER_COUNT) budgetExceeded();
  let decoded = streamBytes;
  for (const filter of filters) {
    if (!budget.remaining) budgetExceeded();
    const remaining = budget.remaining;
    if (filter === 'ASCII85Decode' || filter === 'A85') {
      const value = decodeAscii85(decoded, remaining);
      if (!value) return null;
      chargeBudget(value.length, budget);
      decoded = value;
      continue;
    }
    if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
      const value = decodeAsciiHex(decoded, remaining);
      if (!value) return null;
      chargeBudget(value.length, budget);
      decoded = value;
      continue;
    }
    if (filter === 'FlateDecode' || filter === 'Fl') {
      let value: Buffer;
      try {
        // Select once: failed wrapped decoding can already have expanded most
        // of the budget before a bad checksum is reported. Never retry it or
        // continue with later streams without accounting for that work.
        value = hasZlibHeader(decoded)
          ? inflateSync(decoded, { maxOutputLength: remaining })
          : inflateRawSync(decoded, { maxOutputLength: remaining });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') budgetExceeded();
        throw new Error('The packing-slip PDF contains an unreadable compressed stream. Upload a readable PDF.');
      }
      chargeBudget(value.length, budget);
      decoded = value;
      continue;
    }

    return null;
  }
  return decoded;
}

export function decodedPdfStreams(source: Buffer) {
  const raw = source.toString('latin1');
  const decoded: Buffer[] = [];
  let searchAt = 0;
  // Count every intermediate filter output, including payloads later rejected.
  // Otherwise repeated expand/shrink chains could evade the document CPU budget.
  const budget: DecodeBudget = { remaining: MAX_EXPANDED_BYTES };
  let visitedStreams = 0;

  while (true) {
    const streamIndex = raw.indexOf('stream', searchAt);
    if (streamIndex < 0) break;

    const delimiter = raw[streamIndex + 6];
    if (delimiter && !/[\r\n\s]/.test(delimiter)) {
      searchAt = streamIndex + 6;
      continue;
    }

    let start = streamIndex + 6;
    if (raw[start] === '\r' && raw[start + 1] === '\n') start += 2;
    else if (raw[start] === '\n' || raw[start] === '\r') start += 1;
    else {
      while (start < raw.length && /[\t ]/.test(raw[start])) start += 1;
      if (raw[start] === '\r' && raw[start + 1] === '\n') start += 2;
      else if (raw[start] === '\n' || raw[start] === '\r') start += 1;
    }

    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    if (++visitedStreams > MAX_STREAM_COUNT || !budget.remaining) budgetExceeded();

    const dictionary = currentObjectDictionary(raw, streamIndex);
    const streamBytes = trimPdfStream(source.subarray(start, end));
    searchAt = end + 9;

    const filters = pdfStreamFilters(dictionary, raw);
    const expanded = filters.length
      ? applyPdfStreamFilters(streamBytes, filters, budget)
      : streamBytes;
    if (!expanded?.length) continue;
    if (!filters.length) chargeBudget(expanded.length, budget);
    decoded.push(expanded);
  }

  return decoded;
}

export function textBearingPdfStreams(buffers: Buffer[]) {
  return buffers.filter((buffer) => {
    const source = buffer.toString('latin1');
    return /(?:^|[\s])BT(?:[\s]|$)/.test(source)
      || /beginbfchar|beginbfrange/.test(source);
  });
}
