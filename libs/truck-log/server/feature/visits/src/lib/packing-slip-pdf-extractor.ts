import { decodedPdfStreams, textBearingPdfStreams } from './packing-slip-pdf-streams';
import {
  extractPdfTextTokens,
  normalizeExtractedText,
  parseCMaps,
  pdfTextObjects,
} from './packing-slip-pdf-text';

export const PackingSlipExtractionStatuses = {
  DETECTED: 'DETECTED',
  NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS: 'AMBIGUOUS',
} as const;

export type PackingSlipExtractionStatus =
  (typeof PackingSlipExtractionStatuses)[keyof typeof PackingSlipExtractionStatuses];

export interface PackingSlipExtractionResult {
  status: PackingSlipExtractionStatus;
  documentId: string | null;
  method: 'PDF_TEXT_LABEL';
  message: string;
  pageCount: number | null;
}

interface Candidate {
  id: string;
  score: number;
  label: string;
}

function collectCandidates(text: string) {
  const compact = text.replace(/\s+/g, ' ');
  const candidates: Candidate[] = [];
  const patterns: Array<{ label: string; score: number; regex: RegExp }> = [
    {
      label: 'Outbound Delivery',
      score: 120,
      regex: /outbound\s+delivery(?:\s*(?:number|no\.?|id|#|:|-))*\s*([0-9]{6,12})/gi,
    },
    {
      label: 'Delivery Note',
      score: 115,
      regex: /delivery\s+note(?:\s*(?:number|no\.?|id|#|:|-))*\s*([0-9]{6,12})/gi,
    },
    {
      label: 'Document / Delivery ID',
      score: 110,
      regex: /document\s*\/\s*delivery(?:\s*(?:number|no\.?|id|#|:|-))*\s*([0-9]{6,12})/gi,
    },
    {
      label: 'SAP Delivery',
      score: 105,
      regex: /sap\s+(?:document|delivery)(?:\s*(?:number|no\.?|id|#|:|-))*\s*([0-9]{6,12})/gi,
    },
    {
      label: 'Delivery',
      score: 90,
      regex: /\bdelivery(?:\s*(?:number|no\.?|id|#|:|-)){1,4}\s*([0-9]{6,12})/gi,
    },
    {
      label: 'Document Number',
      score: 80,
      regex: /\bdocument(?:\s*(?:number|no\.?|id|#|:|-)){1,4}\s*([0-9]{6,12})/gi,
    },
  ];

  for (const pattern of patterns) {
    for (const match of compact.matchAll(pattern.regex)) {
      candidates.push({ id: match[1], score: pattern.score, label: pattern.label });
    }
  }

  for (const lineMatch of text.matchAll(
    /(?:outbound\s+delivery|delivery\s+note|document\s*\/\s*delivery|sap\s+(?:document|delivery)|delivery\s+(?:number|no\.?|id)|document\s+(?:number|no\.?|id))[^\n]{0,100}\n[^\n]{0,80}/gi,
  )) {
    const id = lineMatch[0].match(/\b([0-9]{6,12})\b/);
    if (id) candidates.push({ id: id[1], score: 75, label: 'Labeled next line' });
  }

  return candidates;
}

function selectCandidate(candidates: Candidate[]): PackingSlipExtractionResult {
  const grouped = new Map<string, { id: string; score: number; count: number; labels: Set<string> }>();

  for (const candidate of candidates) {
    const current = grouped.get(candidate.id) ?? {
      id: candidate.id,
      score: candidate.score,
      count: 0,
      labels: new Set<string>(),
    };
    current.score = Math.max(current.score, candidate.score);
    current.count += 1;
    current.labels.add(candidate.label);
    grouped.set(candidate.id, current);
  }

  const ranked = [...grouped.values()].sort(
    (left, right) => right.score - left.score || right.count - left.count || left.id.localeCompare(right.id),
  );

  if (!ranked.length) {
    return {
      status: PackingSlipExtractionStatuses.NOT_FOUND,
      documentId: null,
      method: 'PDF_TEXT_LABEL',
      message:
        'No labeled SAP Document/Delivery ID was detected. Upload a searchable SAP packing-slip PDF; Truck Log will not guess an ID.',
      pageCount: null,
    };
  }

  if (ranked.length > 1) {
    return {
      status: PackingSlipExtractionStatuses.AMBIGUOUS,
      documentId: null,
      method: 'PDF_TEXT_LABEL',
      message: `More than one labeled SAP Document/Delivery ID was detected (${ranked
        .slice(0, 3)
        .map((entry) => entry.id)
        .join(', ')}). Truck Log did not guess which ID is correct.`,
      pageCount: null,
    };
  }

  return {
    status: PackingSlipExtractionStatuses.DETECTED,
    documentId: ranked[0].id,
    method: 'PDF_TEXT_LABEL',
    message: `SAP Document/Delivery ID ${ranked[0].id} detected from the PDF text.`,
    pageCount: null,
  };
}

export function extractPackingSlipMetadata(pdf: Buffer): PackingSlipExtractionResult {
  const headerWindow = pdf.subarray(0, Math.min(pdf.length, 1_024)).toString('latin1');
  if (!headerWindow.includes('%PDF-')) {
    throw new Error('The uploaded file does not contain a valid PDF header.');
  }

  const decodedStreams = decodedPdfStreams(pdf);
  const textStreams = textBearingPdfStreams(decodedStreams);
  const cMap = parseCMaps(textStreams);
  const parts: string[] = [];

  // Parse only stream payloads that actually contain PDF text operators/CMaps.
  // Parsing the complete raw PDF can let binary image/palette bytes open a false
  // literal string and swallow later searchable text (SAP NetWeaver PDFs do this).
  for (const buffer of textStreams) {
    for (const textObject of pdfTextObjects(buffer)) {
      parts.push(...extractPdfTextTokens(textObject, cMap));
    }
  }

  const text = normalizeExtractedText(parts);
  const result = selectCandidate(collectCandidates(text));
  const pageMatches = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g);
  result.pageCount = pageMatches?.length || null;
  return result;
}
