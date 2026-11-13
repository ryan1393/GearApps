import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { lockCutterRequestScope } from '@meshforge/manufacturing/server/data-access';
import type { CutterRequestRecord, CutterRequestRow } from '@meshforge/shared/domain';
import { CUTTER_REQUEST_STATUSES, CreateCutterRequestDto, CutterRequestStatus } from './cutter-requests.dto';

/** E5's request queue, with distinct uncompensated build evidence instead of a stored Built counter. */
export const CUTTER_REQUEST_LIST_SQL = `
WITH linked AS (
  SELECT DISTINCT h.request_id,b.id AS build_id,b.build_number
  FROM public.cutter_request_history h
  JOIN public.cutter_builds b ON b.id=h.build_id
  WHERE h.event_type='AUTO_FULFILLED' AND NOT EXISTS (
    SELECT 1 FROM public.cutter_request_history x
    WHERE x.request_id=h.request_id AND x.build_id=h.build_id AND x.event_type='AUTO_FULFILLMENT_REVERSED'
  )
), evidence AS (
  SELECT r.*, r.status AS stored_status,
    coalesce(s.number,'Missing Summary') AS summary_number,
    coalesce(pt.code,'Missing Part Type') AS part_type_code,
    coalesce(nullif(btrim(concat_ws(' ',u."firstName",u."lastName")),''),u.email,r.requested_by) AS requested_by_name,
    coalesce(nullif(btrim(concat_ws(' ',up."firstName",up."lastName")),''),up.email,r.updated_by) AS updated_by_name,
    coalesce(l.built_quantity,0)::integer AS built_quantity,
    coalesce(l.build_numbers,ARRAY[]::text[]) AS build_numbers,
    coalesce(l.build_ids,ARRAY[]::uuid[]) AS build_ids,
    coalesce(l.builds,'[]'::jsonb) AS builds,
    EXISTS(SELECT 1 FROM public.trays t WHERE t.summary_id=r.summary_id AND t.part_type_id=r.part_type_id
      AND t.enabled=true AND t."deletedAt" IS NULL AND t.blade_count>0) AS work_started
  FROM public.cutter_requests r
  LEFT JOIN public.part_summaries s ON s.id=r.summary_id
  LEFT JOIN public.part_types pt ON pt.id=r.part_type_id
  LEFT JOIN public.users u ON u.id::text=r.requested_by
  LEFT JOIN public.users up ON up.id::text=r.updated_by
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS built_quantity,
      array_agg(link.build_number::text ORDER BY first_event.occurred_at,link.build_id) AS build_numbers,
      array_agg(link.build_id ORDER BY first_event.occurred_at,link.build_id) AS build_ids,
      jsonb_agg(jsonb_build_object('id',link.build_id,'build_number',link.build_number)
        ORDER BY first_event.occurred_at,link.build_id) AS builds
    FROM linked link
    LEFT JOIN LATERAL (SELECT min(h.occurred_at) AS occurred_at FROM public.cutter_request_history h
      WHERE h.request_id=link.request_id AND h.build_id=link.build_id AND h.event_type='AUTO_FULFILLED') first_event ON true
    WHERE link.request_id=r.id
  ) l ON true
  WHERE ($1::boolean OR r.status NOT IN ('COMPLETED','CANCELED'))
), displayed AS (
  SELECT evidence.*,
    coalesce((requested_quantity<=0 OR remaining_quantity<0 OR remaining_quantity>requested_quantity OR built_quantity>requested_quantity
      OR remaining_quantity<>requested_quantity-built_quantity
      OR EXISTS(SELECT 1 FROM public.cutter_request_history h
        JOIN public.cutter_request_build_allocations a ON a.build_id=h.build_id
        WHERE h.request_id=evidence.id AND h.event_type='AUTO_FULFILLED' AND a.legacy_conflict)),true) AS allocation_inconsistent,
    CASE WHEN stored_status='CANCELED' THEN 'CANCELED'
      WHEN stored_status='COMPLETED' THEN 'COMPLETED'
      WHEN remaining_quantity=0 AND built_quantity=requested_quantity AND requested_quantity>0 THEN 'READY'
      WHEN work_started OR built_quantity>0 THEN 'IN_PROGRESS'
      ELSE 'REQUESTED' END AS display_status
  FROM evidence
)
SELECT displayed.*,display_status AS status FROM displayed
ORDER BY CASE display_status WHEN 'REQUESTED' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'READY' THEN 2
  WHEN 'COMPLETED' THEN 3 ELSE 4 END,requested_at NULLS LAST,id`;

@Injectable()
export class CutterRequestsService {
  constructor(@InjectDataSource() private readonly source: DataSource) {}

  list(includeCompleted = false) {
    return this.source.query<CutterRequestRow[]>(CUTTER_REQUEST_LIST_SQL, [includeCompleted]);
  }

  async create(dto: CreateCutterRequestDto, userId: string): Promise<CutterRequestRecord> {
    if (!Number.isInteger(dto.quantity) || dto.quantity<1 || dto.quantity>99) {
      throw new UnprocessableEntityException('Quantity must be a whole number from 1 to 99 cutters.');
    }
    if (dto.notes != null && (typeof dto.notes!=='string' || dto.notes.length>2000)) {
      throw new UnprocessableEntityException('Notes must be 2,000 characters or fewer.');
    }
    const notes = dto.notes?.trim() || null;
    return this.source.transaction('READ COMMITTED', async manager => {
      const [reference] = await manager.query(`SELECT pt.id AS part_type_id
        FROM public.part_summaries s JOIN public.cutter_blade_requirements q ON q.summary_id=s.id
        JOIN public.part_types pt ON pt.id=q.part_type_id
        WHERE s.id=$1 AND s.enabled=true AND s."deletedAt" IS NULL
          AND pt.code=$2 AND pt.code IN ('RING','PINION') AND pt.enabled=true AND pt."deletedAt" IS NULL
          AND q.enabled=true AND q."deletedAt" IS NULL AND q.required_blade_count>0`,
        [dto.summary_id,dto.part_type_code]);
      if (!reference) throw new UnprocessableEntityException('Choose an enabled Summary and Part Type with an enabled cutter blade requirement.');
      // Same pair lock as successful build allocation; callers cannot race a quantity merge.
      await lockCutterRequestScope(manager, dto.summary_id, reference.part_type_id);
      const [existing] = await manager.query(`SELECT * FROM public.cutter_requests
        WHERE summary_id=$1 AND part_type_id=$2 AND status IN ('REQUESTED','IN_PROGRESS','READY') AND remaining_quantity>0
        ORDER BY requested_at NULLS LAST,id LIMIT 1 FOR UPDATE`, [dto.summary_id,reference.part_type_id]);
      let row;
      let event: string;
      if (existing) {
        const [{ built }] = await manager.query(`SELECT count(DISTINCT h.build_id)::integer AS built
          FROM public.cutter_request_history h JOIN public.cutter_builds b ON b.id=h.build_id
          WHERE h.request_id=$1 AND h.event_type='AUTO_FULFILLED' AND NOT EXISTS(
            SELECT 1 FROM public.cutter_request_history x WHERE x.request_id=h.request_id AND x.build_id=h.build_id
              AND x.event_type='AUTO_FULFILLMENT_REVERSED')`, [existing.id]);
        if (!Number.isInteger(existing.requested_quantity) || existing.requested_quantity<=0 ||
            !Number.isInteger(existing.remaining_quantity) || existing.remaining_quantity!==existing.requested_quantity-built ||
            existing.remaining_quantity<0 || built>existing.requested_quantity) {
          throw new ConflictException('The oldest matching request has inconsistent legacy counts. Review its history before adding quantity.');
        }
        if (existing.requested_quantity>2147483647-dto.quantity || existing.remaining_quantity>2147483647-dto.quantity) {
          throw new ConflictException('This request has reached the supported quantity limit. Close or cancel it before creating another.');
        }
        [row] = await manager.query(`WITH changed AS (UPDATE public.cutter_requests SET requested_quantity=requested_quantity+$2,
          remaining_quantity=remaining_quantity+$2,notes=coalesce($3,notes),updated_by=$4,updated_at=clock_timestamp()
          WHERE id=$1 RETURNING *) SELECT * FROM changed`, [existing.id,dto.quantity,notes,userId]);
        event = 'QUANTITY_ADDED';
      } else {
        [row] = await manager.query(`INSERT INTO public.cutter_requests
          (id,summary_id,part_type_id,requested_quantity,remaining_quantity,status,requested_by,updated_by,notes,requested_at,updated_at)
          VALUES($1,$2,$3,$4,$4,'REQUESTED',$5,$5,$6,clock_timestamp(),clock_timestamp()) RETURNING *`,
          [randomUUID(),dto.summary_id,reference.part_type_id,dto.quantity,userId,notes]);
        event = 'CREATED';
      }
      await manager.query(`INSERT INTO public.cutter_request_history(id,request_id,event_type,user_id,notes,quantity_delta,occurred_at)
        VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())`, [randomUUID(),row.id,event,userId,notes,dto.quantity]);
      return row;
    });
  }

  async updateStatus(id: string, status: CutterRequestStatus, userId: string): Promise<CutterRequestRecord> {
    if (!CUTTER_REQUEST_STATUSES.includes(status)) throw new UnprocessableEntityException('Invalid request status.');
    return this.source.transaction('READ COMMITTED', async manager => {
      const [before] = await manager.query('SELECT * FROM public.cutter_requests WHERE id=$1 FOR UPDATE', [id]);
      if (!before) throw new NotFoundException('Cutter request not found.');
      if (['COMPLETED','CANCELED'].includes(before.status)) throw new ConflictException('Completed or canceled requests cannot be reopened or changed.');
      // Recovered API semantics: manual closure does not alter quantities, builds, or completed_at.
      const [row] = await manager.query(`WITH changed AS (UPDATE public.cutter_requests SET status=$2,updated_by=$3,updated_at=clock_timestamp()
        WHERE id=$1 RETURNING *) SELECT * FROM changed`, [id,status,userId]);
      await manager.query(`INSERT INTO public.cutter_request_history(id,request_id,event_type,user_id,notes,quantity_delta,occurred_at)
        VALUES($1,$2,'STATUS_CHANGED',$3,$4,0,clock_timestamp())`, [randomUUID(),id,userId,`${before.status} → ${status}`]);
      return row;
    });
  }
}
