import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PaginationOptionsDto } from '../dtos';
import { PAGINATION_MAX_PAGE_SIZE, PaginationService } from './pagination.service';

describe('PaginationService', () => {
  it('never returns an unlimited page', () => {
    expect(PaginationService.calculateTake(undefined, undefined)).toBe(10);
    expect(PaginationService.calculateTake(undefined, 10)).toBe(10);
    expect(PaginationService.calculateTake(undefined, 50)).toBe(50);
    expect(PaginationService.calculateTake(100, undefined)).toBe(100);
    expect(PaginationService.calculateTake(30, 50)).toBe(30);
    expect(PaginationService.calculateTake(undefined, 5000)).toBe(PAGINATION_MAX_PAGE_SIZE);
    expect(PaginationService.calculateTake(5000, 5000)).toBe(PAGINATION_MAX_PAGE_SIZE);
    expect(PAGINATION_MAX_PAGE_SIZE).toBe(100);
  });

  it('describes the page from the offset', () => {
    expect(PaginationService.createPaginationMeta(188, 50, 0)).toMatchObject({
      page: 1,
      totalPages: 4,
      totalItems: 188,
      perPage: 50,
      hasNextPage: true,
      hasPreviousPage: false,
    });
    expect(PaginationService.createPaginationMeta(188, 50, 150)).toMatchObject({
      page: 4,
      hasNextPage: false,
      hasPreviousPage: true,
    });
    expect(PaginationService.createPaginationMeta(0, 50, 0)).toMatchObject({
      page: 1,
      totalPages: 1,
      hasNextPage: false,
    });
  });

  it('pages a query with take and skip', async () => {
    const builder = {
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn(function (this: { expressionMap: { take?: number } }, value: number) {
        this.expressionMap.take = value;
        return this;
      }),
      skip: jest.fn(function (this: { expressionMap: { skip?: number } }, value: number) {
        this.expressionMap.skip = value;
        return this;
      }),
      expressionMap: {} as { take?: number; skip?: number },
      getManyAndCount: jest.fn().mockResolvedValue([[], 188]),
    };
    const repo = { metadata: { tableName: 'part_summaries' }, createQueryBuilder: () => builder };
    const service = new PaginationService({} as never, repo as never);
    const result = await service.paginate(plainToInstance(PaginationOptionsDto, { perPage: 50, page: 2 }));
    expect(builder.take).toHaveBeenCalledWith(50);
    expect(builder.skip).toHaveBeenCalledWith(50);
    expect(result.meta).toMatchObject({ page: 2, perPage: 50, totalPages: 4, hasNextPage: true });
  });

  it('rejects page sizes above 100 in the request', async () => {
    const errors = (value: object) => validate(plainToInstance(PaginationOptionsDto, value));
    expect(await errors({ perPage: '100', limit: '100' })).toHaveLength(0);
    expect(await errors({ perPage: '101' })).toHaveLength(1);
    expect(await errors({ limit: '1000' })).toHaveLength(1);
  });
});
