import { FindOptionsWhere, Repository } from 'typeorm';

import {
  CreatePartSummaryDto,
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
  Injectable,
  Logger,
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


  async updatePartSummary(partSummaryId: Uuid, data: Partial<IPartSummaryEntity>, userId: Uuid) {
    await this.partSummaryRepo.save({ id: partSummaryId, ...data, updatedBy: userId, });
    return await this.partSummaryRepo.findOneOrFail({ where: { id: partSummaryId } });
  }

  async deletePartSummary(partSummaryId: Uuid, userId: Uuid): Promise<void> {
    const partSummary = await this.partSummaryRepo.findOne({ where: { id: partSummaryId } });
    if (!partSummary) {
      this.logger.log(
        `Request received to delete partSummary ${partSummaryId} - but partSummary does not exist!`,
      );
      throw new UnprocessableEntityException(`Error deleting partSummary`);
    }
    partSummary.updatedBy = userId;
    await partSummary.save();
    await partSummary.softRemove();
  }
}
