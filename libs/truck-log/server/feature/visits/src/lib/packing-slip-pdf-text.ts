/*
 * Text recovery from decoded PDF content streams: ToUnicode CMaps, literal and
 * hex strings, text objects and whitespace normalization (bounded output).
 */

const MAX_TEXT_CHARACTERS = 4_000_000;

function decodeUtf16Be(hex: string) {
  const cleaned = hex.replace(/\s+/g, '').replace(/^FEFF/i, '');
  let output = '';
  for (let index = 0; index + 3 < cleaned.length; index += 4) {
    const value = Number.parseInt(cleaned.slice(index, index + 4), 16);
    if (Number.isFinite(value)) output += String.fromCharCode(value);
  }
  return output;
}

export function parseCMaps(buffers: Buffer[]) {
  const map = new Map<string, string>();

  for (const buffer of buffers) {
    const source = buffer.toString('latin1');

    for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        map.set(pair[1].toUpperCase(), decodeUtf16Be(pair[2]));
      }
    }

    for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      const body = block[1];

      for (const range of body.matchAll(
        /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
      )) {
        const start = Number.parseInt(range[1], 16);
        const end = Number.parseInt(range[2], 16);
        const destination = Number.parseInt(range[3], 16);
        const width = range[1].length;
        const count = end - start + 1;
        if (!Number.isFinite(count) || count < 1 || count > 2_048) continue;

        for (let offset = 0; offset < count; offset += 1) {
          const key = (start + offset).toString(16).toUpperCase().padStart(width, '0');
          const value = (destination + offset).toString(16).toUpperCase().padStart(4, '0');
          map.set(key, decodeUtf16Be(value));
        }
      }

      for (const range of body.matchAll(
        /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g,
      )) {
        const start = Number.parseInt(range[1], 16);
        const end = Number.parseInt(range[2], 16);
        const width = range[1].length;
        const destinations = [...range[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map(
          (entry) => entry[1],
        );
        const count = Math.min(end - start + 1, destinations.length, 2_048);

        for (let offset = 0; offset < count; offset += 1) {
          const key = (start + offset).toString(16).toUpperCase().padStart(width, '0');
          map.set(key, decodeUtf16Be(destinations[offset]));
        }
      }
    }
  }

  return map;
}

function decodeLiteralString(buffer: Buffer, start: number) {
  const output: number[] = [];
  let depth = 1;
  let index = start + 1;

  while (index < buffer.length && depth > 0) {
    const value = buffer[index];

    if (value === 0x5c) {
      index += 1;
      if (index >= buffer.length) break;
      const escaped = buffer[index];
      const named = new Map<number, number>([
        [0x6e, 0x0a],
        [0x72, 0x0d],
        [0x74, 0x09],
        [0x62, 0x08],
        [0x66, 0x0c],
      ]);

      if (named.has(escaped)) {
        output.push(named.get(escaped)!);
      } else if (escaped === 0x0d || escaped === 0x0a) {
        if (escaped === 0x0d && buffer[index + 1] === 0x0a) index += 1;
      } else if (escaped >= 0x30 && escaped <= 0x37) {
        let octal = String.fromCharCode(escaped);
        for (let count = 0; count < 2; count += 1) {
          const next = buffer[index + 1];
          if (next < 0x30 || next > 0x37) break;
          index += 1;
          octal += String.fromCharCode(next);
        }
        output.push(Number.parseInt(octal, 8));
      } else {
        output.push(escaped);
      }
    } else if (value === 0x28) {
      depth += 1;
      output.push(value);
    } else if (value === 0x29) {
      depth -= 1;
      if (depth > 0) output.push(value);
    } else {
      output.push(value);
    }

    index += 1;
  }

  return {
    bytes: Buffer.from(output),
    end: index,
  };
}

function decodePlainBytes(bytes: Buffer) {
  if (!bytes.length) return '';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.subarray(2).toString('hex'));
  }

  let zeroEven = 0;
  let zeroOdd = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index % 2 === 0) zeroEven += 1;
    else zeroOdd += 1;
  }

  if (bytes.length >= 4 && Math.max(zeroEven, zeroOdd) >= bytes.length / 4) {
    return decodeUtf16Be(bytes.toString('hex'));
  }

  return bytes.toString('latin1');
}

function decodeHexWithCMap(hex: string, map: Map<string, string>) {
  if (!map.size) return null;
  const cleaned = hex.replace(/\s+/g, '').toUpperCase();
  const widths = [...new Set([...map.keys()].map((key) => key.length))].sort(
    (left, right) => right - left,
  );
  let output = '';
  let index = 0;

  while (index < cleaned.length) {
    let matched = false;
    for (const width of widths) {
      const key = cleaned.slice(index, index + width);
      if (key.length !== width || !map.has(key)) continue;
      output += map.get(key);
      index += width;
      matched = true;
      break;
    }
    if (!matched) return null;
  }

  return output;
}

export function pdfTextObjects(buffer: Buffer) {
  const source = buffer.toString('latin1');
  const objects: Buffer[] = [];
  const pattern = /(?:^|[\s])BT(?:[\s])([\s\S]*?)(?:[\s])ET(?=[\s]|$)/g;
  for (const match of source.matchAll(pattern)) {
    objects.push(Buffer.from(match[1], 'latin1'));
  }
  return objects;
}

export function extractPdfTextTokens(buffer: Buffer, cMap: Map<string, string>) {
  const output: string[] = [];

  for (let index = 0; index < buffer.length; index += 1) {
    const value = buffer[index];

    if (value === 0x28) {
      const literal = decodeLiteralString(buffer, index);
      output.push(decodePlainBytes(literal.bytes));
      index = Math.max(index, literal.end - 1);
      continue;
    }

    if (value === 0x3c && buffer[index + 1] !== 0x3c) {
      const end = buffer.indexOf(0x3e, index + 1);
      if (end < 0) continue;
      const hex = buffer
        .subarray(index + 1, end)
        .toString('ascii')
        .replace(/\s+/g, '');
      if (hex && /^[0-9A-Fa-f]+$/.test(hex)) {
        const evenHex = hex.length % 2 === 0 ? hex : `${hex}0`;
        output.push(
          decodeHexWithCMap(evenHex, cMap) ??
            decodePlainBytes(Buffer.from(evenHex, 'hex')),
        );
      }
      index = end;
    }
  }

  return output;
}

export function normalizeExtractedText(parts: string[]) {
  return parts
    .join('\n')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, MAX_TEXT_CHARACTERS);
}
