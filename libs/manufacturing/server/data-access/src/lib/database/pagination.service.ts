import { instanceToPlain } from 'class-transformer';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_DEFAULT_ORDER,
  PAGINATION_DEFAULT_PER_PAGE,
} from '@meshforge/manufacturing/shared/util-constants';
import { Logger } from '@nestjs/common';

import {
  PaginationMetaDto,
  PaginationOptionsDto,
  PaginationResponseDto,
} from '../dtos';

/** The largest page any paginated list returns. */
export const PAGINATION_MAX_PAGE_SIZE = PAGINATION_DEFAULT_LIMIT;

export class PaginationService<OrmEntity extends AbstractOrmEntity> {
  private readonly _logger: Logger;
  private repo: Repository<OrmEntity>;
  constructor(entity: OrmEntity, repo: Repository<OrmEntity>) {
    this._logger = new Logger(`${entity.constructor.name} Pagination`);
    this.repo = repo;
  }

  private get alias(): string {
    return this.repo.metadata.tableName;
  }

  /**
   * Single entry point for creating a payload with paginated data. Allows for an
   * optional serialization function if custom logic is needed to convert an ORM
   * entity.
   *
   * @param opts
   * @param serializeFn
   * @returns
   */
  async paginate<SerializedEntityType>(
    opts?: PaginationOptionsDto,
    serializeFn?: (entity: OrmEntity) => SerializedEntityType,
  ): Promise<PaginationResponseDto<SerializedEntityType>> {
    this._logger.debug(
      `Paginating response for entities in table ${this.alias}`,
    );
    const qb = this.createBuilder(opts);

    const [items, total] = await qb.getManyAndCount();
    const limit = qb.expressionMap.take ?? PAGINATION_DEFAULT_PER_PAGE;
    const offset = qb.expressionMap.skip ?? 0;

    const meta = PaginationService.createPaginationMeta(total, limit, offset);
    const data = serializeFn
      ? items.map(serializeFn)
      : items.map((i) => instanceToPlain(i) as SerializedEntityType);

    return new PaginationResponseDto(data, meta);
  }

  /**
   * Creates a QueryBuilder instance configured with pagination options such as page,
   * perPage, order, and skip
   * @param builder
   */
  private createBuilder(
    opts?: PaginationOptionsDto,
  ): SelectQueryBuilder<OrmEntity> {
    const builder = this.repo.createQueryBuilder(this.alias);
    this._logger.debug(
      `Creating pagination builder with opts:\n${JSON.stringify(
        opts,
        null,
        2,
      )}`,
    );

    // TODO add ability to sort by arbitrary columns instead of createdAt
    builder.orderBy(`${this.alias}.createdAt`, opts?.order ?? PAGINATION_DEFAULT_ORDER);
    const take = PaginationService.calculateTake(opts?.limit, opts?.perPage);
    builder.take(take);
    const page = opts?.page && opts.page >= 1 ? Math.floor(opts.page) : 1;
    if (page > 1) builder.skip(take * (page - 1));

    return builder;
  }

  /** Page metadata. The page follows the offset even past the last page (which is then empty). */
  static createPaginationMeta(
    total: number,
    limit: number,
    offset: number,
  ): PaginationMetaDto {
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const page = Math.floor(offset / limit) + 1;
    return new PaginationMetaDto({
      page,
      totalPages,
      totalItems: total,
      perPage: limit,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    });
  }

  /**
   * Page size: the smaller of `limit` and `perPage` when given, else the default page size,
   * never more than PAGINATION_MAX_PAGE_SIZE. There is no unlimited page: callers page through.
   */
  static calculateTake(limit?: number, perPage?: number): number {
    const requested = [limit, perPage].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1,
    );
    const size = requested.length
      ? Math.floor(Math.min(...requested))
      : PAGINATION_DEFAULT_PER_PAGE;
    return Math.min(Math.max(size, 1), PAGINATION_MAX_PAGE_SIZE);
  }

}
