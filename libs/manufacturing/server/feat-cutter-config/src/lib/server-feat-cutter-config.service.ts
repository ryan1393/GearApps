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
  readSummaryBodyRule,
} from '@meshforge/manufacturing/server/data-access';
import {
  CUTTER_BODY_RULES,
  cutterBodyRuleByCode,
  formatBladeSetQuantity,
  isApprovedBladeSetCount,
  summaryBodyRuleState,
  totalBladesForSets,
} from '@meshforge/manufacturing/shared/util-constants';
import { BladeStatus, ISummaryBodyRuleRow, IValidateCutterTrayResult, Uuid } from '@meshforge/manufacturing/shared/util-types';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
    assertApprovedBladeSets(dto.required_blade_count);

    return this.requirementRepo.manager.transaction(async (manager) => {
      await lockSummaryRequirements(manager, dto.summary_id);
      const existing = await manager.findOne(CutterBladeRequirementOrmEntity, {
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
      // Required quantity is Summary-based: a new Part Type row must agree with the
      // Summary's configured rule and with the quantity its other Part Types use.
      await assertSummaryQuantity(manager, dto.summary_id, dto.required_blade_count, null);
      return manager.save(manager.create(CutterBladeRequirementOrmEntity, dto));
    });
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
    if (dto.required_blade_count !== undefined) assertApprovedBladeSets(dto.required_blade_count);

    const duplicate = await this.requirementRepo.findOne({
      where: { summary_id: summaryId, part_type_id: partTypeId },
    });
    if (duplicate && duplicate.id !== id) {
      throw new ConflictException(
        'A blade requirement already exists for this summary and part type',
      );
    }

    await this.requirementRepo.manager.transaction(async (manager) => {
      await lockSummaryRequirements(manager, summaryId);
      const quantity = dto.required_blade_count ?? current.required_blade_count;
      const configured = await readSummaryBodyRule(manager, summaryId);
      const rule = cutterBodyRuleByCode(configured);
      if (rule && rule.blade_sets !== quantity) {
        throw new ConflictException(
          `This Summary's Body Size Rule is ${rule.label} (${formatBladeSetQuantity(rule.blade_sets)}). Change the Body Size Rule instead of the quantity.`,
        );
      }
      if (summaryId !== current.summary_id) {
        await assertSummaryQuantity(manager, summaryId, quantity, id);
      }
      await manager.update(CutterBladeRequirementOrmEntity, id, dto);
      if (dto.required_blade_count !== undefined) {
        // Summary-based quantity: every Part Type row of this Summary moves together.
        // Part Type rows stay distinct; only the shared quantity changes.
        await manager.query(
          `UPDATE public.cutter_blade_requirements SET required_blade_count=$2, "updatedAt"=now()
            WHERE summary_id=$1 AND id<>$3 AND required_blade_count<>$2`,
          [summaryId, dto.required_blade_count, id],
        );
      }
    });
    return this.requirementRepo.findOneOrFail({
      where: { id },
      relations: { summary: true, part_type: true },
    });
  }

  /** Every Summary with its configured or derived Body Size Rule and Summary-based quantity. */
  async listSummaryBodyRules(): Promise<ISummaryBodyRuleRow[]> {
    const rows: Array<{
      summary_id: string; summary_number: string; summary_revision: string | null; summary_enabled: boolean;
      model_number: string | null; body_rule: string | null;
      requirements: Array<{ id: string; part_type_code: string; required_blade_count: number; enabled: boolean }> | null;
    }> = await this.requirementRepo.manager.query(`
      SELECT s.id AS summary_id, s.number AS summary_number, s.revision AS summary_revision, s.enabled AS summary_enabled,
             m.model_number::text AS model_number, r.body_rule,
             (SELECT json_agg(json_build_object('id', q.id, 'part_type_code', pt.code,
                       'required_blade_count', q.required_blade_count, 'enabled', q.enabled) ORDER BY pt.code)
                FROM public.cutter_blade_requirements q JOIN public.part_types pt ON pt.id=q.part_type_id
               WHERE q.summary_id=s.id AND q."deletedAt" IS NULL) AS requirements
        FROM public.part_summaries s
        LEFT JOIN public.models m ON m.id=s.model_id
        LEFT JOIN public.cutter_summary_body_rules r ON r.summary_id=s.id
       WHERE s."deletedAt" IS NULL
       ORDER BY s.number, s.revision`);
    return rows.map((row) => toSummaryBodyRuleRow(row));
  }

  /**
   * Set a Summary's Body Size Rule. The rule controls the Summary-based quantity,
   * so every existing Part Type requirement row moves to the rule's quantity.
   * Missing Part Type rows are not invented. Tray snapshots are not changed.
   */
  async setSummaryBodyRule(summaryId: Uuid, bodyRule: string, userId: Uuid) {
    const rule = cutterBodyRuleByCode(bodyRule);
    if (!rule) {
      throw new UnprocessableEntityException(
        `Body Size Rule must be one of ${CUTTER_BODY_RULES.map((r) => r.code).join(', ')}`,
      );
    }
    const summary = await this.summaryRepo.findOne({ where: { id: summaryId } });
    if (!summary) throw new NotFoundException('Part summary not found');
    const openTrays = await this.requirementRepo.manager.transaction(async (manager) => {
      await lockSummaryRequirements(manager, summaryId);
      await manager.query(
        `INSERT INTO public.cutter_summary_body_rules (summary_id, body_rule, "createdBy", "updatedBy")
         VALUES ($1,$2,$3,$3)
         ON CONFLICT (summary_id) DO UPDATE SET body_rule=EXCLUDED.body_rule, "updatedAt"=now(), "updatedBy"=EXCLUDED."updatedBy"`,
        [summaryId, rule.code, userId],
      );
      await manager.query(
        `UPDATE public.cutter_blade_requirements SET required_blade_count=$2, "updatedAt"=now()
          WHERE summary_id=$1 AND required_blade_count<>$2`,
        [summaryId, rule.blade_sets],
      );
      return countTraysWithOtherSnapshot(manager, summaryId, rule.blade_sets);
    });
    const [row] = (await this.listSummaryBodyRules()).filter((r) => r.summary_id === summaryId);
    return { ...row, open_trays_with_other_quantity: openTrays };
  }

  /** Remove a configured rule. Quantities are left exactly as they are. */
  async clearSummaryBodyRule(summaryId: Uuid) {
    await this.requirementRepo.manager.query(
      'DELETE FROM public.cutter_summary_body_rules WHERE summary_id=$1',
      [summaryId],
    );
    const [row] = (await this.listSummaryBodyRules()).filter((r) => r.summary_id === summaryId);
    if (!row) throw new NotFoundException('Part summary not found');
    return row;
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
        `Tray must contain exactly ${formatBladeSetQuantity(requirement.required_blade_count)}; declared=${tray.blade_count} sets, active=${activeBladeCount} sets`,
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
      required_total_blades: totalBladesForSets(requirement.required_blade_count),
      summary_body_rule: await readSummaryBodyRule(this.requirementRepo.manager, dto.summary_id),
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

function assertApprovedBladeSets(sets: number): void {
  if (!isApprovedBladeSetCount(sets)) {
    const allowed = CUTTER_BODY_RULES.map((r) => `${r.blade_sets} sets (${r.total_blades} blades, ${r.label})`).join(', ');
    throw new UnprocessableEntityException(
      `Required quantity is counted in matched inner/outer blade sets and must be an approved body rule: ${allowed}`,
    );
  }
}

async function lockSummaryRequirements(manager: EntityManager, summaryId: string): Promise<void> {
  await manager.query("SELECT pg_advisory_xact_lock(hashtext('cutter-summary-requirement:' || $1::text))", [summaryId]);
}

async function assertSummaryQuantity(manager: EntityManager, summaryId: string, sets: number, exceptId: string | null): Promise<void> {
  const rule = cutterBodyRuleByCode(await readSummaryBodyRule(manager, summaryId));
  if (rule && rule.blade_sets !== sets) {
    throw new ConflictException(`This Summary's Body Size Rule is ${rule.label}; its requirement must be ${formatBladeSetQuantity(rule.blade_sets)}`);
  }
  const others: Array<{ required_blade_count: number }> = await manager.query(
    'SELECT required_blade_count FROM public.cutter_blade_requirements WHERE summary_id=$1 AND ($2::uuid IS NULL OR id<>$2::uuid)',
    [summaryId, exceptId],
  );
  const conflict = others.find((row) => Number(row.required_blade_count) !== sets);
  if (conflict) {
    throw new ConflictException(
      `Required quantity is Summary-based: this Summary's other Part Types use ${formatBladeSetQuantity(Number(conflict.required_blade_count))}`,
    );
  }
}

async function countTraysWithOtherSnapshot(manager: EntityManager, summaryId: string, sets: number): Promise<number> {
  const [row] = await manager.query(
    `SELECT count(*)::int AS n FROM public.trays
      WHERE summary_id=$1 AND enabled=true AND "deletedAt" IS NULL
        AND required_blade_count IS NOT NULL AND required_blade_count<>$2`,
    [summaryId, sets],
  );
  return Number(row?.n ?? 0);
}

export function toSummaryBodyRuleRow(row: {
  summary_id: string; summary_number: string; summary_revision: string | null; summary_enabled: boolean;
  model_number: string | null; body_rule: string | null;
  requirements: Array<{ id: string; part_type_code: string; required_blade_count: number; enabled: boolean }> | null;
}): ISummaryBodyRuleRow {
  const requirements = (row.requirements ?? []).map((r) => ({ ...r, required_blade_count: Number(r.required_blade_count) }));
  const state = summaryBodyRuleState(row.body_rule, requirements.map((r) => r.required_blade_count));
  return {
    summary_id: row.summary_id,
    summary_number: row.summary_number,
    summary_revision: row.summary_revision,
    summary_enabled: row.summary_enabled,
    model_number: row.model_number,
    configured_body_rule: row.body_rule,
    status: state.status,
    effective_body_rule: state.effective_rule?.code ?? null,
    effective_body_rule_label: state.effective_rule?.label ?? null,
    required_blade_sets: state.blade_sets,
    required_total_blades: totalBladesForSets(state.blade_sets),
    detail: state.detail,
    requirements,
  };
}

const isGearsetType = (code: string | null | undefined) =>
  code?.trim().toUpperCase() === 'GEARSET';
