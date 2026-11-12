import { EntityManager, FindOptionsWhere, Repository } from 'typeorm';

import {
  CreatePartSummaryDto,
  lockSummaryRequirements,
  PaginationOptionsDto,
  PaginationService,
} from '@meshforge/manufacturing/server/data-access';
import {
  IPaginatedResponse,
  IPartSummary,
  IPartSummaryEntity,
  Uuid,
} from '@meshforge/manufacturing/shared/util-types';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PartSummaryOrmEntity } from '@meshforge/manufacturing/server/data-access';

@Injectable()
export class ServerFeatPartSummaryService extends PaginationService<PartSummaryOrmEntity> {
  private readonly logger = new Logger(ServerFeatPartSummaryService.name);

  constructor(
    @InjectRepository(PartSummaryOrmEntity)
    private partSummaryRepo: Repository<PartSummaryOrmEntity>,
  ) {
    super(PartSummaryOrmEntity.prototype, partSummaryRepo);
  }

  async findPartSummary(
    find: FindOptionsWhere<PartSummaryOrmEntity>,
  ): Promise<PartSummaryOrmEntity | null> {
    return this.partSummaryRepo.findOneBy(find);
  }


  async createPartSummary(dto: CreatePartSummaryDto, userId: Uuid): Promise<PartSummaryOrmEntity> {

    const partSummary = this.partSummaryRepo.create({
      ...dto,
      revision: dto.revision?.trim() ?? '',
      createdBy: userId,
      updatedBy: userId,
    });
    await partSummary.save();
    return partSummary;
  }

  async getPartSummary(partSummaryId: Uuid) {
    return await this.partSummaryRepo.findOneOrFail({ where: { id: partSummaryId } });
  }

  async getPartSummaries(
    paginationOptions?: PaginationOptionsDto,
  ): Promise<IPaginatedResponse<IPartSummary>> {
    return this.paginate<IPartSummary>(paginationOptions, (entity) => entity.toJSON());
  }


  /**
   * Updates an existing Summary only (an unknown id is 404, never an insert). Takes the same
   * row and requirement locks, and the same number/revision duplicate check, as Admin > Part
   * Summaries' save in cutter-config.
   */
  async updatePartSummary(partSummaryId: Uuid, data: Partial<IPartSummaryEntity>, userId: Uuid) {
    return this.partSummaryRepo.manager.transaction(async (manager) => {
      const summary = await this.lockSummary(manager, partSummaryId);
      const changes: Partial<IPartSummaryEntity> = { ...data };
      if (data.number !== undefined) {
        changes.number = String(data.number ?? '').trim();
        if (!changes.number) throw new UnprocessableEntityException('Part Summary number is required');
      }
      if (data.revision !== undefined) changes.revision = String(data.revision ?? '').trim();
      if (changes.number !== undefined || changes.revision !== undefined) {
        const number = changes.number ?? summary.number;
        const revision = changes.revision ?? summary.revision;
        const [duplicate] = await manager.query(
          'SELECT id FROM public.part_summaries WHERE number=$1 AND revision=$2 AND id<>$3', [number, revision, partSummaryId],
        );
        if (duplicate) throw new ConflictException(`Part Summary ${number}${revision ? ` revision ${revision}` : ''} already exists`);
      }
      const repo = manager.getRepository(PartSummaryOrmEntity);
      await repo.save({ ...changes, id: partSummaryId, updatedBy: userId });
      return repo.findOneOrFail({ where: { id: partSummaryId } });
    });
  }

  /** Soft-deletes a Summary nothing uses. One still referenced by trays, blades or blade requirements stays. */
  async deletePartSummary(partSummaryId: Uuid, userId: Uuid): Promise<void> {
    await this.partSummaryRepo.manager.transaction(async (manager) => {
      const [found] = await manager.query(
        'SELECT id FROM public.part_summaries WHERE id=$1 AND "deletedAt" IS NULL FOR UPDATE', [partSummaryId],
      );
      if (!found) {
        this.logger.log(
          `Request received to delete partSummary ${partSummaryId} - but partSummary does not exist!`,
        );
        throw new UnprocessableEntityException(`Error deleting partSummary`);
      }
      await lockSummaryRequirements(manager, partSummaryId);
      const [usage] = await manager.query(
        `SELECT
           (SELECT count(*)::int FROM public.trays WHERE summary_id=$1 AND "deletedAt" IS NULL) AS trays,
           (SELECT count(*)::int FROM public.blades WHERE summary_id=$1 AND "deletedAt" IS NULL) AS blades,
           (SELECT count(*)::int FROM public.cutter_blade_requirements WHERE summary_id=$1 AND "deletedAt" IS NULL) AS requirements`,
        [partSummaryId],
      ) as Array<{ trays: number; blades: number; requirements: number }>;
      const trays = Number(usage?.trays ?? 0);
      const blades = Number(usage?.blades ?? 0);
      const requirements = Number(usage?.requirements ?? 0);
      if (trays || blades || requirements) {
        throw new ConflictException(
          `This Part Summary is still used by ${trays} tray(s), ${blades} blade(s) and ${requirements} blade requirement(s). Disable it instead.`,
        );
      }
      const repo = manager.getRepository(PartSummaryOrmEntity);
      const partSummary = await repo.findOneOrFail({ where: { id: partSummaryId } });
      partSummary.updatedBy = userId;
      await repo.save(partSummary);
      await repo.softRemove(partSummary);
    });
  }

  private async lockSummary(manager: EntityManager, partSummaryId: Uuid): Promise<{ number: string; revision: string }> {
    const [summary] = await manager.query(
      'SELECT id, number, revision FROM public.part_summaries WHERE id=$1 AND "deletedAt" IS NULL FOR UPDATE', [partSummaryId],
    ) as Array<{ id: string; number: string; revision: string }>;
    if (!summary) throw new NotFoundException('Part summary not found');
    await lockSummaryRequirements(manager, partSummaryId);
    return summary;
  }
}
