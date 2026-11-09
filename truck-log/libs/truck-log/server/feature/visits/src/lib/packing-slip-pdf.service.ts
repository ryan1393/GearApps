import { BadRequestException, Injectable } from '@nestjs/common';
import {
  extractPackingSlipMetadata,
  type PackingSlipExtractionResult,
} from './packing-slip-pdf-extractor';

@Injectable()
export class PackingSlipPdfService {
  extract(buffer: Buffer): PackingSlipExtractionResult {
    try {
      return extractPackingSlipMetadata(buffer);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'The packing-slip PDF could not be read.',
      );
    }
  }
}
