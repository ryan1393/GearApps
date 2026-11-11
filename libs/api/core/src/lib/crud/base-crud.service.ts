import { BaseEntity } from '@meshforge/shared/domain';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeepPartial, FindOptionsRelations, FindOptionsWhere, Repository } from 'typeorm';

/**
 * Generic repository-backed CRUD. Feature services extend this and only add
 * the queries that are actually specific to their entity.
 */
export abstract class BaseCrudService<T extends BaseEntity> {
  /** Relations to eagerly load on reads. Override per entity. */
  protected readonly relations: FindOptionsRelations<T> = {};
  /** Default ordering for list reads. */
  protected readonly order: Record<string, 'ASC' | 'DESC'> | undefined = undefined;
  protected readonly entityName: string;

  protected constructor(
    protected readonly repo: Repository<T>,
    entityName?: string,
  ) {
    this.entityName = entityName ?? repo.metadata.name;
  }

  findAll(where?: FindOptionsWhere<T>): Promise<T[]> {
    return this.repo.find({ where, relations: this.relations, order: this.order as never });
  }

  async findOne(id: string): Promise<T> {
    const entity = await this.repo.findOne({
      where: { id } as FindOptionsWhere<T>,
      relations: this.relations,
    });
    if (!entity) throw new NotFoundException(`${this.entityName} ${id} not found`);
    return entity;
  }

  async create(data: DeepPartial<T>, _requestKey?: string): Promise<T> {
    void _requestKey; // Legacy stores do not implement PostgreSQL ingestion deduplication.
    const saved = await this.repo.save(this.repo.create(data));
    return this.findOne(saved.id);
  }

  async update(id: string, data: DeepPartial<T>): Promise<T> {
    await this.findOne(id);
    await this.repo.save({ ...data, id } as DeepPartial<T>);
    return this.findOne(id);
  }

  /** PUT semantics: replace if the id exists, create it if not. */
  async upsert(id: string, data: DeepPartial<T> & { id?: string }): Promise<T> {
    if (data.id && data.id !== id) throw new BadRequestException('Body id does not match URL id');
    await this.repo.save({ ...data, id } as DeepPartial<T>);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const entity = await this.findOne(id);
    await this.repo.remove(entity);
  }
}
