import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';

interface BuildAllocationInput {
  buildId: string;
  summaryId: string;
  partTypeId: string;
}

interface AllocationResult {
  requestId: string;
  buildId: string;
}

interface AllocationRow {
  build_id: string;
  request_id: string | null;
  reversed_at: Date | string | null;
  legacy_conflict: boolean;
}

function requireTransaction(manager: EntityManager): void {
  if (!manager.queryRunner?.isTransactionActive) {
    throw new Error('Cutter request allocation requires the cutter workflow transaction');
  }
}

/** Serializes queue creation and fulfillment for the same Summary/Part Type pair. */
export async function lockCutterRequestScope(
  manager: EntityManager,
  summaryId: string,
  partTypeId: string,
): Promise<void> {
  requireTransaction(manager);
  await manager.query(
    "SELECT pg_advisory_xact_lock(hashtext('cutter-request-scope'), hashtext($1))",
    // PostgreSQL UUID equality is case-insensitive; its lock identity must be too.
    [`${summaryId.toLowerCase()}:${partTypeId.toLowerCase()}`],
  );
}

/**
 * Called only by the successful assembly transaction, never by a request-list refresh,
 * a historical import, or a draft/read operation. One completed cutter supplies one
 * request unit, independently of the blade quantity used to build it.
 */
export async function allocateCutterRequest(
  manager: EntityManager,
  input: BuildAllocationInput,
  userId: string,
): Promise<AllocationResult | null> {
  requireTransaction(manager);
  const summaryId = input.summaryId.toLowerCase();
  const partTypeId = input.partTypeId.toLowerCase();

  // Serialize repeated delivery for this build before inspecting its immutable ledger key.
  // completed_at is deliberately absent: it records physical teardown, not assembly.
  const [build] = await manager.query(
    `SELECT b.id, b.summary_id, b.part_type_id, b.built_at, b."deletedAt",
            s.code AS status_code,
            EXISTS (SELECT 1 FROM public.cutter_events e
                    JOIN public.cutter_event_types t ON t.id = e.event_type_id
                    WHERE e.cutter_build_id = b.id AND t.code = 'CB'
                      AND e."deletedAt" IS NULL) AS has_build_event
       FROM public.cutter_builds b
       JOIN public.cutter_build_statuses s ON s.id = b.status_id
      WHERE b.id = $1 FOR UPDATE OF b`,
    [input.buildId],
  );
  if (!build) return null;

  const previous: AllocationRow[] = await manager.query(
    'SELECT build_id, request_id, reversed_at, legacy_conflict FROM public.cutter_request_build_allocations WHERE build_id = $1',
    [input.buildId],
  );
  // A reversed build remains consumed as an event identity; it cannot be reassigned on retry.
  if (previous.length) return null;
  if (
    build.deletedAt ||
    !build.built_at ||
    !build.has_build_event ||
    build.status_code !== 'READY' ||
    build.summary_id !== summaryId ||
    build.part_type_id !== partTypeId
  )
    return null;

  // Preserve surviving historical evidence even if a conservative schema migration could
  // not import its association into the ledger. A repeated old event is never new supply.
  const historical = await manager.query(
    `SELECT 1 FROM public.cutter_request_history
      WHERE build_id = $1 AND event_type = 'AUTO_FULFILLED' LIMIT 1`,
    [input.buildId],
  );
  if (historical.length) return null;
  await lockCutterRequestScope(manager, summaryId, partTypeId);

  // Do not skip a locked older request: that would silently change FIFO ordering.
  // SERIALIZABLE callers may receive a serialization conflict and retry the whole build.
  const [request] = await manager.query(
    `SELECT r.id FROM public.cutter_requests r
      WHERE r.summary_id = $1 AND r.part_type_id = $2
        AND r.status IN ('REQUESTED', 'IN_PROGRESS', 'READY')
        AND r.requested_quantity > 0 AND r.remaining_quantity > 0
        AND r.remaining_quantity <= r.requested_quantity
        AND r.remaining_quantity = r.requested_quantity - (
          SELECT count(DISTINCT h.build_id) FROM public.cutter_request_history h
          JOIN public.cutter_builds b ON b.id = h.build_id
          WHERE h.request_id = r.id AND h.event_type = 'AUTO_FULFILLED'
            AND NOT EXISTS (
              SELECT 1 FROM public.cutter_request_history reversed
              WHERE reversed.request_id = h.request_id AND reversed.build_id = h.build_id
                AND reversed.event_type = 'AUTO_FULFILLMENT_REVERSED'
            )
        )
      ORDER BY r.requested_at ASC, r.id ASC LIMIT 1 FOR UPDATE OF r`,
    [summaryId, partTypeId],
  );

  const inserted = await manager.query(
    `INSERT INTO public.cutter_request_build_allocations (build_id, request_id, fulfilled_at)
     VALUES ($1, $2, clock_timestamp()) ON CONFLICT (build_id) DO NOTHING RETURNING build_id`,
    [input.buildId, request?.id ?? null],
  );
  // The NULL request sentinel records an unmatched successful build as already processed.
  // A retry after somebody creates a new request must not retroactively allocate this build.
  if (!inserted.length || !request) return null;

  const updated = await manager.query(
    `WITH changed AS (UPDATE public.cutter_requests
        SET remaining_quantity = remaining_quantity - 1,
            status = CASE WHEN remaining_quantity = 1 THEN 'READY' ELSE 'IN_PROGRESS' END,
            updated_by = $2, updated_at = clock_timestamp(), completed_at = NULL
      WHERE id = $1 AND remaining_quantity > 0
      RETURNING id) SELECT id FROM changed`,
    [request.id, userId],
  );
  if (!updated.length) {
    throw new ConflictException('The cutter request changed during fulfillment. Retry the build.');
  }
  await manager.query(
    `INSERT INTO public.cutter_request_history
      (id, request_id, build_id, event_type, user_id, quantity_delta, notes, occurred_at)
     VALUES ($1, $2, $3, 'AUTO_FULFILLED', $4, -1, $5, clock_timestamp())`,
    [
      randomUUID(),
      request.id,
      input.buildId,
      userId,
      'Completed cutter build allocated automatically',
    ],
  );
  return { requestId: request.id, buildId: input.buildId };
}

/** Compensates an eligible Cancel Last build void, preserving the original fulfillment evidence. */
export async function reverseCutterRequestAllocation(
  manager: EntityManager,
  buildId: string,
  userId: string,
  reason: string,
): Promise<AllocationResult | null> {
  requireTransaction(manager);
  const [build] = await manager.query(
    'SELECT id, summary_id, part_type_id, "deletedAt" FROM public.cutter_builds WHERE id = $1 FOR UPDATE',
    [buildId],
  );
  // Ordinary setup, pull, and teardown must never erase prior fulfillment.
  if (!build || !build.deletedAt) return null;
  await lockCutterRequestScope(manager, build.summary_id, build.part_type_id);

  const [allocation]: AllocationRow[] = await manager.query(
    `SELECT build_id, request_id, reversed_at, legacy_conflict FROM public.cutter_request_build_allocations
      WHERE build_id = $1 FOR UPDATE`,
    [buildId],
  );
  if (!allocation) {
    const survivingLinks = await manager.query(
      `SELECT 1 FROM public.cutter_request_history h
        WHERE h.build_id = $1 AND h.event_type = 'AUTO_FULFILLED'
          AND NOT EXISTS (
            SELECT 1 FROM public.cutter_request_history reversed
             WHERE reversed.request_id = h.request_id AND reversed.build_id = h.build_id
               AND reversed.event_type = 'AUTO_FULFILLMENT_REVERSED'
          ) LIMIT 1`,
      [buildId],
    );
    if (survivingLinks.length) {
      throw new ConflictException(
        'This build has request history without a matching allocation record. Review its request links before canceling the build.',
      );
    }
    return null;
  }
  if (allocation.reversed_at) return null;
  if (allocation.legacy_conflict) {
    throw new ConflictException(
      'This build has conflicting historical request links. Review its request history before canceling the build.',
    );
  }
  if (!allocation.request_id) return null;

  // The counter alone is insufficient for legacy rows: confirm its distinct, uncompensated
  // evidence and this particular build link before appending a compensating unit.
  const [request] = await manager.query(
    `SELECT r.id, r.requested_quantity, r.remaining_quantity, r.status,
            evidence.built_quantity, evidence.has_build_evidence
       FROM public.cutter_requests r
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT h.build_id)::integer AS built_quantity,
                coalesce(bool_or(h.build_id = $2), false) AS has_build_evidence
           FROM public.cutter_request_history h
           JOIN public.cutter_builds b ON b.id = h.build_id
          WHERE h.request_id = r.id AND h.event_type = 'AUTO_FULFILLED'
            AND NOT EXISTS (
              SELECT 1 FROM public.cutter_request_history reversed
               WHERE reversed.request_id = h.request_id AND reversed.build_id = h.build_id
                 AND reversed.event_type = 'AUTO_FULFILLMENT_REVERSED'
            )
       ) evidence ON true
      WHERE r.id = $1 FOR UPDATE OF r`,
    [allocation.request_id, buildId],
  );
  if (
    !request ||
    !Number.isInteger(request.requested_quantity) ||
    !Number.isInteger(request.remaining_quantity) ||
    !Number.isInteger(request.built_quantity) ||
    request.requested_quantity < 1 ||
    request.remaining_quantity < 0 ||
    request.remaining_quantity >= request.requested_quantity ||
    request.remaining_quantity !== request.requested_quantity - request.built_quantity ||
    !request.has_build_evidence
  ) {
    throw new ConflictException(
      'The linked request counts cannot be safely reversed. Review the request before canceling this build.',
    );
  }

  await manager.query(
    `UPDATE public.cutter_requests
        SET remaining_quantity = remaining_quantity + 1,
            status = CASE WHEN status IN ('COMPLETED', 'CANCELED') THEN status ELSE 'IN_PROGRESS' END,
            updated_by = $2, updated_at = clock_timestamp(),
            completed_at = CASE WHEN status IN ('COMPLETED', 'CANCELED') THEN completed_at ELSE NULL END
      WHERE id = $1`,
    [allocation.request_id, userId],
  );
  await manager.query(
    'UPDATE public.cutter_request_build_allocations SET reversed_at = clock_timestamp() WHERE build_id = $1',
    [buildId],
  );
  await manager.query(
    `INSERT INTO public.cutter_request_history
      (id, request_id, build_id, event_type, user_id, quantity_delta, notes, occurred_at)
     VALUES ($1, $2, $3, 'AUTO_FULFILLMENT_REVERSED', $4, 1, $5, clock_timestamp())`,
    [randomUUID(), allocation.request_id, buildId, userId, reason.trim()],
  );
  return { requestId: allocation.request_id, buildId };
}
