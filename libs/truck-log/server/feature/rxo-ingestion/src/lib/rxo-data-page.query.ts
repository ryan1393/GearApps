import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { normalizeRxoSite } from './rxo-data-page.clauses';
import { listRxoFreightPage, listRxoOrdersPage, listRxoShipmentsPage } from './rxo-data-page.kinds';

export { activeRxoPlantWindowClause, activeRxoStatusClause, normalizeRxoSite } from './rxo-data-page.clauses';

type Row = Record<string, unknown>;

export interface RxoDataPageQueryContext {
  dataSource: DataSource;
  plantTimeZone: string;
  orderStopDate: (row: Row, kind: 'pickup' | 'delivery') => Date | null;
  withDriverDocumentState: (rows: Array<Record<string, unknown>>) => Promise<Array<Record<string, unknown>>>;
}

export async function listRxoDataPage(
  ctx: RxoDataPageQueryContext,
    kind?: string,
    site?: string,
    direction?: string,
    q?: string,
    page = 1,
    pageSize = 100,
  ) {
    const normalizedKind = (kind ?? 'orders').trim().toLowerCase();

    if (!['orders', 'shipments', 'freight'].includes(normalizedKind)) {
      throw new BadRequestException(
        'kind must be orders, shipments, or freight.',
      );
    }

    const normalizedDirection = direction?.trim().toUpperCase();

    if (
      normalizedDirection &&
      !['INBOUND', 'OUTBOUND'].includes(normalizedDirection)
    ) {
      throw new BadRequestException(
        'direction must be INBOUND or OUTBOUND.',
      );
    }

    const safePage = Number.isFinite(page)
      ? Math.max(Math.trunc(page), 1)
      : 1;

    const safePageSize = Number.isFinite(pageSize)
      ? Math.min(Math.max(Math.trunc(pageSize), 1), 250)
      : 100;

    const offset = (safePage - 1) * safePageSize;
    const siteKey = normalizeRxoSite(site);
    const search = q?.trim() ? `%${q.trim()}%` : null;
    const clauses: string[] = [];
    const params: unknown[] = [];

    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const plantTimeZoneToken = bind(ctx.plantTimeZone);

    const scope = {
      ctx,
      clauses,
      params,
      bind,
      plantTimeZoneToken,
      siteKey,
      normalizedDirection,
      search,
      offset,
      safePage,
      safePageSize,
    };

    if (normalizedKind === 'orders') {
      return listRxoOrdersPage(scope);
    }

    if (normalizedKind === 'shipments') {
      return listRxoShipmentsPage(scope);
    }

    return listRxoFreightPage(scope);
  }
