import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateDockDto } from './dto/create-dock.dto';
import { Dock } from '@truck-log/server/data-access';

@Injectable()
export class DocksService {
  constructor(@InjectRepository(Dock) private readonly docks: Repository<Dock>) {}

  list() {
    return this.docks.find({ order: { active: 'DESC', sortOrder: 'ASC', code: 'ASC' } });
  }

  async create(dto: CreateDockDto) {
    const code = dto.code.trim().toUpperCase();
    if (!code) throw new BadRequestException('Dock code is required.');
    const existing = await this.docks.createQueryBuilder('dock')
      .where('UPPER(dock.code) = :code', { code })
      .getOne();
    if (existing) throw new ConflictException(`Dock ${code} already exists.`);
    return this.docks.save(this.docks.create({
      code,
      description: dto.description?.trim() || null,
      active: dto.active ?? true,
      sortOrder: dto.sortOrder ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  }

  async setActive(id: number, active: boolean) {
    const dock = await this.docks.findOne({ where: { id } });
    if (!dock) throw new NotFoundException('Dock not found.');
    dock.active = active;
    dock.updatedAt = new Date();
    return this.docks.save(dock);
  }
}
