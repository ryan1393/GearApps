import {
  BladeTrayOrmEntity,
  CutterBladeRequirementOrmEntity,
  ContainerTrayOrmEntity,
  CutterBuildTrayOrmEntity,
  CutterPartTypeOrmEntity,
  PartSummaryOrmEntity,
  PartOrmEntity,
  RollMasterOrmEntity,
  TrayOrmEntity,
} from '@gearapps/manufacturing/server/data-access';
import { BladeStatus, IValidateCutterTrayResult, Uuid } from '@gearapps/manufacturing/shared/util-types';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CreateCutterBladeRequirementDto,
  UpdateCutterBladeRequirementDto,
  ValidateCutterTrayDto,
} from './cutter-config.dto';
import { CreatePartDto, UpdatePartDto } from './part.dto';
import { CreateRollMasterDto, UpdateRollMasterDto } from './roll-master.dto';

@Injectable()
export class ServerFeatCutterConfigService {
  constructor(
    @InjectRepository(CutterBladeRequirementOrmEntity)
    private readonly requirementRepo: Repository<CutterBladeRequirementOrmEntity>,
    @InjectRepository(CutterPartTypeOrmEntity)
    private readonly partTypeRepo: Repository<CutterPartTypeOrmEntity>,
    @InjectRepository(PartSummaryOrmEntity)
    private readonly summaryRepo: Repository<PartSummaryOrmEntity>,
    @InjectRepository(PartOrmEntity)
    private readonly partRepo: Repository<PartOrmEntity>,
    @InjectRepository(RollMasterOrmEntity)
    private readonly rollMasterRepo: Repository<RollMasterOrmEntity>,
    @InjectRepository(TrayOrmEntity)
    private readonly trayRepo: Repository<TrayOrmEntity>,
    @InjectRepository(BladeTrayOrmEntity)
    private readonly bladeTrayRepo: Repository<BladeTrayOrmEntity>,
    @InjectRepository(CutterBuildTrayOrmEntity)
    private readonly cutterBuildTrayRepo: Repository<CutterBuildTrayOrmEntity>,
    @InjectRepository(ContainerTrayOrmEntity)
    private readonly containerTrayRepo: Repository<ContainerTrayOrmEntity>,
  ) {}

  async listRequirements(includeDisabled = false): Promise<CutterBladeRequirementOrmEntity[]> {
    return this.requirementRepo.find({
      where: includeDisabled ? {} : { enabled: true },
      relations: { summary: true, part_type: true },
      order: { createdAt: 'ASC' },
    });
  }

  async listParts(filters: {
    q?: string;
    summaryId?: string;
    partTypeId?: string;
    active?: string;
    includeDisabled?: string;
  }): Promise<PartOrmEntity[]> {
    const qb = this.partRepo
      .createQueryBuilder('part')
      .leftJoinAndSelect('part.summary', 'summary')
      .leftJoinAndSelect('part.part_type', 'partType')
      .leftJoinAndSelect(
        'part.roll_master',
        'rollMaster',
        'rollMaster.enabled = :rollMasterEnabled',
        { rollMasterEnabled: true },
      )
      // The part master is a bounded reference list. Machine Setup and Admin both need all of
      // it; a row cap here silently hid every part that sorted after the cap.
      .orderBy('part.part_number', 'ASC');

    if (filters.includeDisabled?.trim().toLowerCase() !== 'true') {
      qb.where('part.enabled = :enabled', { enabled: true });
    }

    if (filters.q?.trim()) {
      qb.andWhere('part.part_number ILIKE :q', {
        q: `%${filters.q.trim()}%`,
      });
    }

    if (filters.summaryId?.trim()) {
      qb.andWhere('part.summary_id = :summaryId', {
        summaryId: filters.summaryId.trim(),
      });
    }

    if (filters.partTypeId?.trim()) {
      qb.andWhere('part.part_type_id = :partTypeId', {
        partTypeId: filters.partTypeId.trim(),
      });
    }

    if (filters.active?.trim()) {
      const normalized = filters.active.trim().toUpperCase();
      if (!['TRUE', 'FALSE', 'ALL'].includes(normalized)) {
        throw new UnprocessableEntityException(
          'Part active filter must be true, false, or all',
        );
      }
      if (normalized !== 'ALL') {
        qb.andWhere('part.active = :active', {
          active: normalized === 'TRUE',
        });
      }
    } else {
      qb.andWhere('part.active = :active', { active: true });
    }

    return qb.getMany();
  }

  async getPartByNumber(partNumber: string): Promise<PartOrmEntity> {
    const normalized = partNumber.trim().toUpperCase();
    const part = await this.partRepo.findOne({
      where: {
        part_number: normalized,
        enabled: true,
      },
      relations: {
        summary: { model: true },
        part_type: true,
        roll_master: true,
      },
    });

    if (!part) {
      throw new NotFoundException(`Part ${normalized} not found`);
    }

    return part;
  }

  async createPart(dto: CreatePartDto, userId: Uuid): Promise<PartOrmEntity> {
    const { partType } = await this.assertReferences(
      dto.summary_id,
      dto.part_type_id,
    );
    if (isGearsetType(partType.code)) {
      throw new ConflictException(
        'Gearset parts are created with their assembly. Use Admin > Gearsets.',
      );
    }

    const partNumber = dto.part_number.trim().toUpperCase();
    const existing = await this.partRepo.findOne({
      where: { part_number: partNumber },
    });
    if (existing) {
      throw new ConflictException(`Part ${partNumber} already exists`);
    }

    const entity = this.partRepo.create({
      part_number: partNumber,
      summary_id: dto.summary_id,
      part_type_id: dto.part_type_id,
      teeth: dto.teeth ?? null,
      active: dto.active ?? true,
      enabled: dto.enabled ?? true,
      createdBy: userId,
      updatedBy: userId,
    });

    return this.partRepo.save(entity);
  }

  async updatePart(
    id: Uuid,
    dto: UpdatePartDto,
    userId: Uuid,
  ): Promise<PartOrmEntity> {
    const current = await this.partRepo.findOne({ where: { id } });
    if (!current) {
      throw new NotFoundException('Part not found');
    }

    const summaryId = dto.summary_id ?? current.summary_id;
    const partTypeId = dto.part_type_id ?? current.part_type_id;
    const { partType } = await this.assertReferences(summaryId, partTypeId);

    const partNumber =
      dto.part_number?.trim().toUpperCase() ?? current.part_number;

    const typeChanges = partTypeId !== current.part_type_id;
    if (typeChanges) {
      const currentType = await this.partTypeRepo.findOne({
        where: { id: current.part_type_id },
      });
      if (isGearsetType(partType.code) || isGearsetType(currentType?.code)) {
        throw new ConflictException(
          'A part cannot be changed to or from the Gearset type.',
        );
      }
    }
    const identityChanges =
      typeChanges ||
      partNumber !== current.part_number ||
      summaryId !== current.summary_id ||
      (dto.teeth !== undefined && dto.teeth !== current.teeth);
    if (identityChanges && (await this.belongsToGearset(id))) {
      throw new ConflictException(
        `Part ${current.part_number} belongs to a gearset, so its number, type, summary and teeth are fixed. Its status can still change.`,
      );
    }

    const duplicate = await this.partRepo.findOne({
      where: { part_number: partNumber },
    });
    if (duplicate && duplicate.id !== id) {
      throw new ConflictException(`Part ${partNumber} already exists`);
    }

    current.part_number = partNumber;
    current.summary_id = summaryId;
    current.part_type_id = partTypeId;
    if (dto.teeth !== undefined) current.teeth = dto.teeth;
    if (dto.active !== undefined) current.active = dto.active;
    if (dto.enabled !== undefined) current.enabled = dto.enabled;
    current.updatedBy = userId;

    await this.partRepo.save(current);

    return this.partRepo.findOneOrFail({
      where: { id },
      relations: {
        summary: { model: true },
        part_type: true,
        roll_master: true,
      },
    });
  }

  async listRollMasters(filters: {
    partId?: string;
    active?: string;
    includeDisabled?: string;
  }): Promise<RollMasterOrmEntity[]> {
    const qb = this.rollMasterRepo
      .createQueryBuilder('rollMaster')
      .leftJoinAndSelect('rollMaster.part', 'part')
      .leftJoinAndSelect('part.summary', 'summary')
      .leftJoinAndSelect('part.part_type', 'partType')
      .orderBy('part.part_number', 'ASC');

    if (filters.includeDisabled?.trim().toLowerCase() !== 'true') {
      qb.where('rollMaster.enabled = :enabled', { enabled: true });
    }

    if (filters.partId?.trim()) {
      qb.andWhere('rollMaster.part_id = :partId', {
        partId: filters.partId.trim(),
      });
    }

    if (filters.active?.trim()) {
      const normalized = filters.active.trim().toUpperCase();
      if (!['TRUE', 'FALSE', 'ALL'].includes(normalized)) {
        throw new UnprocessableEntityException(
          'Roll Master active filter must be true, false, or all',
        );
      }
      if (normalized !== 'ALL') {
        qb.andWhere('rollMaster.active = :active', {
          active: normalized === 'TRUE',
        });
      }
    } else {
      qb.andWhere('rollMaster.active = :active', { active: true });
    }

    return qb.getMany();
  }

  async createRollMaster(
    dto: CreateRollMasterDto,
  ): Promise<RollMasterOrmEntity> {
    const part = await this.partRepo.findOne({
      where: { id: dto.part_id, enabled: true },
    });
    if (!part) {
      throw new NotFoundException('Part not found');
    }

    const existing = await this.rollMasterRepo.findOne({
      where: { part_id: part.id },
    });
    if (existing) {
      throw new ConflictException(
        `Roll Master requirement already exists for Part ${part.part_number}`,
      );
    }

    return this.rollMasterRepo.save(
      this.rollMasterRepo.create({
        part_id: part.id,
        required_count: dto.minimum_quantity ?? dto.required_count ?? 0,
        current_quantity: dto.current_quantity ?? 0,
        minimum_quantity: dto.minimum_quantity ?? dto.required_count ?? 0,
        active: dto.active ?? true,
        enabled: dto.enabled ?? true,
        notes: dto.notes?.trim() || null,
      }),
    );
  }

  async updateRollMaster(
    id: Uuid,
    dto: UpdateRollMasterDto,
  ): Promise<RollMasterOrmEntity> {
    const current = await this.rollMasterRepo.findOne({
      where: { id },
      relations: { part: true },
    });
    if (!current) {
      throw new NotFoundException('Roll Master requirement not found');
    }

    if (dto.part_id !== undefined && dto.part_id !== current.part_id) {
      const part = await this.partRepo.findOne({
        where: { id: dto.part_id, enabled: true },
      });
      if (!part) {
        throw new NotFoundException('Part not found');
      }

      const duplicate = await this.rollMasterRepo.findOne({
        where: { part_id: part.id },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(
          `Roll Master requirement already exists for Part ${part.part_number}`,
        );
      }
      current.part_id = part.id;
    }

    if (dto.minimum_quantity !== undefined || dto.required_count !== undefined) {
      const minimum = dto.minimum_quantity ?? dto.required_count ?? current.minimum_quantity;
      current.minimum_quantity = minimum;
      current.required_count = minimum;
    }
    if (dto.current_quantity !== undefined) {
      current.current_quantity = dto.current_quantity;
    }
    if (dto.active !== undefined) current.active = dto.active;
    if (dto.enabled !== undefined) current.enabled = dto.enabled;
    if (dto.notes !== undefined) current.notes = dto.notes?.trim() || null;

    return this.rollMasterRepo.save(current);
  }

  async listPartTypes(): Promise<CutterPartTypeOrmEntity[]> {
    return this.partTypeRepo.find({
      where: { enabled: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
  }

  async createRequirement(
    dto: CreateCutterBladeRequirementDto,
  ): Promise<CutterBladeRequirementOrmEntity> {
    await this.assertReferences(dto.summary_id, dto.part_type_id);

    const existing = await this.requirementRepo.findOne({
      where: {
        summary_id: dto.summary_id,
        part_type_id: dto.part_type_id,
      },
    });
    if (existing) {
      throw new ConflictException(
        'A blade requirement already exists for this summary and part type',
      );
    }

    return this.requirementRepo.save(this.requirementRepo.create(dto));
  }

  async updateRequirement(
    id: Uuid,
    dto: UpdateCutterBladeRequirementDto,
  ): Promise<CutterBladeRequirementOrmEntity> {
    const current = await this.requirementRepo.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Cutter blade requirement not found');

    const summaryId = dto.summary_id ?? current.summary_id;
    const partTypeId = dto.part_type_id ?? current.part_type_id;
    await this.assertReferences(summaryId, partTypeId);

    const duplicate = await this.requirementRepo.findOne({
      where: { summary_id: summaryId, part_type_id: partTypeId },
    });
    if (duplicate && duplicate.id !== id) {
      throw new ConflictException(
        'A blade requirement already exists for this summary and part type',
      );
    }

    await this.requirementRepo.update(id, dto);
    return this.requirementRepo.findOneOrFail({
      where: { id },
      relations: { summary: true, part_type: true },
    });
  }

  async resolveRequirement(
    summaryId: Uuid,
    partTypeId: Uuid,
  ): Promise<CutterBladeRequirementOrmEntity> {
    const requirement = await this.requirementRepo.findOne({
      where: {
        summary_id: summaryId,
        part_type_id: partTypeId,
        enabled: true,
      },
      relations: { summary: true, part_type: true },
    });

    if (!requirement) {
      throw new NotFoundException(
        'No enabled blade requirement exists for this summary and part type',
      );
    }

    return requirement;
  }

  async validateTray(dto: ValidateCutterTrayDto): Promise<IValidateCutterTrayResult> {
    const requirement = await this.resolveRequirement(
      dto.summary_id,
      dto.part_type_id,
    );

    const tray = await this.trayRepo.findOne({
      where: { serial_number: dto.tray_serial_number, enabled: true },
      relations: { summary: true, part_type: true, current_stage: true },
    });
    if (!tray) {
      throw new NotFoundException(
        `Tray ${dto.tray_serial_number} could not be found`,
      );
    }

    const activeAssignments = await this.bladeTrayRepo.find({
      where: { tray_id: tray.id, enabled: true },
      relations: { blade: true },
    });

    const activeBladeCount = activeAssignments.length;
    const summaryMatches = tray.summary_id === dto.summary_id;
    const partTypeMatches = tray.part_type_id === dto.part_type_id;
    const grindingComplete = Boolean(tray.grinding_completed_at);
    const trayStageReady = tray.current_stage?.code === 'READY_FOR_CUTTER';

    const bladeIdentityMatches = activeAssignments.every(
      ({ blade }) =>
        blade.enabled &&
        blade.summary_id === dto.summary_id &&
        blade.part_type_id === dto.part_type_id,
    );

    const bladesReadyForCutter = activeAssignments.every(
      ({ blade }) => blade.status === BladeStatus.RETURNED_FROM_COATING,
    );

    const activeBuildAssignment = await this.cutterBuildTrayRepo.findOne({
      where: { tray_id: tray.id, enabled: true },
    });
    const alreadyAssignedToBuild = Boolean(activeBuildAssignment);

    const activeContainerAssignment = await this.containerTrayRepo.findOne({
      where: { tray_id: tray.id, enabled: true },
    });
    const stillInContainer = Boolean(activeContainerAssignment);

    const snapshotMatches =
      tray.required_blade_count === requirement.required_blade_count;

    const countMatches =
      activeBladeCount === requirement.required_blade_count &&
      tray.blade_count === requirement.required_blade_count;

    const valid =
      grindingComplete &&
      trayStageReady &&
      summaryMatches &&
      partTypeMatches &&
      bladeIdentityMatches &&
      bladesReadyForCutter &&
      snapshotMatches &&
      countMatches &&
      !alreadyAssignedToBuild &&
      !stillInContainer;

    const reasons: string[] = [];
    if (!grindingComplete) reasons.push('Grinding has not been completed for this tray');
    if (!trayStageReady) reasons.push('Tray is not in READY_FOR_CUTTER stage');
    if (!summaryMatches) reasons.push('Tray summary does not match the selected cutter summary');
    if (!partTypeMatches) reasons.push('Tray part type does not match the selected cutter part type');
    if (!bladeIdentityMatches) reasons.push('One or more blade records do not match the tray summary/part type');
    if (!bladesReadyForCutter) reasons.push('Every blade must be returned from coating before Cutter Builder can use this tray');
    if (!snapshotMatches) reasons.push('Tray post-grind quantity snapshot does not match the current configured requirement');
    if (!countMatches) {
      reasons.push(
        `Tray must contain exactly ${requirement.required_blade_count} blades; declared=${tray.blade_count}, active=${activeBladeCount}`,
      );
    }
    if (alreadyAssignedToBuild) reasons.push('Tray is already assigned to an active cutter build');
    if (stillInContainer) reasons.push('Tray is still loaded in a container');

    return {
      valid,
      tray_id: tray.id,
      tray_serial_number: tray.serial_number,
      grinding_complete: grindingComplete,
      required_blade_count: requirement.required_blade_count,
      tray_declared_blade_count: tray.blade_count,
      active_blade_count: activeBladeCount,
      requirement_id: requirement.id,
      summary_matches: summaryMatches,
      part_type_matches: partTypeMatches,
      blade_identity_matches: bladeIdentityMatches,
      blades_ready_for_cutter: bladesReadyForCutter,
      already_assigned_to_build: alreadyAssignedToBuild,
      still_in_container: stillInContainer,
      tray_stage_ready: trayStageReady,
      reason: valid ? undefined : reasons.join('; '),
    };
  }

  async disableRequirement(id: Uuid): Promise<void> {
    const requirement = await this.requirementRepo.findOne({ where: { id } });
    if (!requirement) {
      throw new UnprocessableEntityException(
        'Cutter blade requirement not found',
      );
    }
    requirement.enabled = false;
    await requirement.save();
  }

  // Gearset assemblies (public.gearsets) pin their gearset, ring and pinion parts.
  private async belongsToGearset(partId: Uuid): Promise<boolean> {
    const rows: unknown[] = await this.partRepo.manager.query(
      'SELECT 1 FROM public.gearsets WHERE gearset_part_id = $1 OR ring_part_id = $1 OR pinion_part_id = $1 LIMIT 1',
      [partId],
    );
    return rows.length > 0;
  }

  private async assertReferences(
    summaryId: Uuid,
    partTypeId: Uuid,
  ): Promise<{ partType: CutterPartTypeOrmEntity }> {
    const [summary, partType] = await Promise.all([
      this.summaryRepo.findOne({
        where: { id: summaryId, enabled: true },
      }),
      this.partTypeRepo.findOne({
        where: { id: partTypeId, enabled: true },
      }),
    ]);

    if (!summary) throw new NotFoundException('Part summary not found or disabled');
    if (!partType) throw new NotFoundException('Part type not found or disabled');
    return { partType };
  }
}

const isGearsetType = (code: string | null | undefined) =>
  code?.trim().toUpperCase() === 'GEARSET';
