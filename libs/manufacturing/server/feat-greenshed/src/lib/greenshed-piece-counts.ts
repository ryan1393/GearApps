import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

export interface RunPieceCounts {
  current_piece_count: number;
  last_check_piece_count: number;
}

export const DSF_MANUAL_PIECE_COUNT_MESSAGE =
  'Piece counts come from DSF while DSF production counts are on, so they cannot be entered by hand. Record quality checks as usual.';

/**
 * The run's counts after a quality check taken at `pieceCount`. Refuses a count the check
 * may not record.
 *
 * - Operator-counted cutters: the check also sets the running count, so it cannot go backwards.
 * - DSF-counted cutters: DSF alone moves the running count, so a check leaves it as it is and
 *   only records the count it was taken at (at or after the previous check). The next check
 *   is due from that count.
 */
export function countsAfterQualityCheck(run: RunPieceCounts, pieceCount: number, dsfCounts: boolean): RunPieceCounts {
  if (dsfCounts) {
    if (pieceCount < run.last_check_piece_count) {
      throw new UnprocessableEntityException(
        `Check piece count cannot be below previous check count ${run.last_check_piece_count}`,
      );
    }
    return { current_piece_count: run.current_piece_count, last_check_piece_count: pieceCount };
  }
  if (pieceCount < run.current_piece_count) {
    throw new UnprocessableEntityException(
      `Check piece count cannot be below current machine count ${run.current_piece_count}`,
    );
  }
  return { current_piece_count: pieceCount, last_check_piece_count: pieceCount };
}

/** A typed running count would compete with the counts DSF credits to the cutter. */
export function assertManualPieceCountAllowed(dsfCounts: boolean): void {
  if (dsfCounts) throw new ConflictException(DSF_MANUAL_PIECE_COUNT_MESSAGE);
}
