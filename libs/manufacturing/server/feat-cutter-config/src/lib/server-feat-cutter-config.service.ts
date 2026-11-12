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
  CutterBodyDefinitionCodes,
  CutterBodyMatrixRow,
  CutterBodyMatrixSummaryInput,
  buildCutterBodyCompatibilityMatrix,
  cutterBodyRuleByCode,
  evaluateCutterBodyCompatibility,
  permittedCutterBodyDefinitions,
  SUMMARY_PART_TYPE_CODES,
  bladeLabelProblem,
  normalizeBladeLabel,
  normalizeSummaryHos,
  summaryHosProblem,
  formatBladeSetQuantity,
  isApprovedBladeSetCount,
  summaryBodyRuleState,
  totalBladesForSets,
} from '@meshforge/manufacturing/shared/util-constants';
import { BladeStatus, IPartSummarySettings, ISummaryBodyRuleRow, ISummaryPartTypeSettings, IValidateCutterTrayResult, Uuid } from '@meshforge/manufacturing/shared/util-types';
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
  SavePartSummaryDto,
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

    return this.withBladeSettings(await qb.getMany());
  }

  /**
   * Inner blade and Outer blade of each part, read from its own Summary + Part Type through
   * public.part_blade_settings. Parts hold no copy; a pair with no settings reads blank.
   */
  private async withBladeSettings<T extends PartOrmEntity>(parts: T[]): Promise<Array<T & { inner_blade: string | null; outer_blade: string | null }>> {
    const result = parts as Array<T & { inner_blade: string | null; outer_blade: string | null }>;
    if (!parts.length) return result;
    const [view] = await this.partRepo.manager.query("SELECT to_regclass('public.part_blade_settings') IS NOT NULL AS present");
    const rows: Array<{ part_id: string; inner_blade: string | null; outer_blade: string | null }> = view?.present
      ? await this.partRepo.manager.query(
        'SELECT part_id, inner_blade, outer_blade FROM public.part_blade_settings WHERE part_id = ANY($1::uuid[])',
        [parts.map((p) => p.id)],
      )
      : [];
    const byPart = new Map(rows.map((r) => [r.part_id, r]));
    for (const part of result) {
      part.inner_blade = byPart.get(part.id)?.inner_blade ?? null;
      part.outer_blade = byPart.get(part.id)?.outer_blade ?? null;
    }
    return result;
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

    return (await this.withBladeSettings([part]))[0];
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
    const definitions = await this.readDefinitions();
    return rows.map((row) => toSummaryBodyRuleRow(row, definitions));
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
      return applySummaryBodyRule(manager, summaryId, rule.code, userId);
    });
    const [row] = (await this.listSummaryBodyRules()).filter((r) => r.summary_id === summaryId);
    return { ...row, open_trays_with_other_quantity: openTrays };
  }

  /**
   * Each Summary with its RING and PINION HOS / Inner blade / Outer blade (blank when not set)
   * and its Body Size Rule state. One row per Summary; both Part Types are always listed.
   */
  async listPartSummarySettings(summaryId: string | null = null): Promise<IPartSummarySettings[]> {
    const manager = this.requirementRepo.manager;
    const [summaries, partTypes, settings, bodyRules] = [
      await manager.query(
        `SELECT id, number, revision, model_id, hos FROM public.part_summaries
          WHERE "deletedAt" IS NULL AND ($1::uuid IS NULL OR id=$1::uuid) ORDER BY number, revision`, [summaryId],
      ) as Array<{ id: string; number: string; revision: string; model_id: string | null; hos: string | null }>,
      await manager.query(
        `SELECT id, code FROM public.part_types WHERE code = ANY($1::text[]) ORDER BY sort_order, code`, [[...SUMMARY_PART_TYPE_CODES]],
      ) as Array<{ id: string; code: string }>,
      await manager.query(
        `SELECT summary_id, part_type_id, hos, inner_blade, outer_blade FROM public.part_summary_part_type_blades
          WHERE ($1::uuid IS NULL OR summary_id=$1::uuid)`, [summaryId],
      ) as Array<{ summary_id: string; part_type_id: string; hos: string | null; inner_blade: string | null; outer_blade: string | null }>,
      new Map((await this.listSummaryBodyRules()).map((row) => [row.summary_id, row])),
    ];
    const bySummary = new Map<string, typeof settings>();
    for (const row of settings) bySummary.set(row.summary_id, [...(bySummary.get(row.summary_id) ?? []), row]);
    return summaries.map((s) => ({
      summary_id: s.id, summary_number: s.number, summary_revision: s.revision, model_id: s.model_id, hos: s.hos,
      part_types: partTypes.map((pt): ISummaryPartTypeSettings => {
        const row = bySummary.get(s.id)?.find((r) => r.part_type_id === pt.id);
        return { part_type_id: pt.id, part_type_code: pt.code, hos: row?.hos ?? null, inner_blade: row?.inner_blade ?? null, outer_blade: row?.outer_blade ?? null };
      }),
      body_rule: bodyRules.get(s.id) as ISummaryBodyRuleRow,
    }));
  }

  /**
   * Save Part Summary: Summary fields, both RING/PINION groups and an explicit Body Size Rule
   * change in ONE transaction. Omitted fields are unchanged; null or '' clears a field.
   * body_rule omitted keeps the mapping; a code changes it (requirements follow, global rule
   * totals untouched); null removes it (quantities stay). Any failure rolls everything back.
   */
  async savePartSummary(summaryId: Uuid, dto: SavePartSummaryDto, userId: Uuid): Promise<IPartSummarySettings> {
    const groups = Object.entries(dto.part_types ?? {}).filter(([, v]) => v !== undefined && v !== null);
    for (const [code, group] of groups) {
      if (!(SUMMARY_PART_TYPE_CODES as readonly string[]).includes(code)) throw new UnprocessableEntityException(`Unknown Part Type ${code}`);
      const problem = (group.hos !== undefined ? summaryHosProblem(group.hos) : null) ??
        (group.inner_blade !== undefined ? bladeLabelProblem(group.inner_blade) : null) ??
        (group.outer_blade !== undefined ? bladeLabelProblem(group.outer_blade) : null);
      if (problem) throw new UnprocessableEntityException(`${code}: ${problem}`);
    }
    const rule = dto.body_rule === undefined || dto.body_rule === null ? null : cutterBodyRuleByCode(dto.body_rule);
    if (dto.body_rule && !rule) {
      throw new UnprocessableEntityException(`Body Size Rule must be one of ${CUTTER_BODY_RULES.map((r) => r.code).join(', ')}`);
    }
    if (dto.number !== undefined && !dto.number.trim()) throw new UnprocessableEntityException('Part Summary number is required');

    let openTrays: number | undefined;
    try {
      openTrays = await this.requirementRepo.manager.transaction(async (manager) => {
        const [summary] = await manager.query(
          'SELECT id, number, revision FROM public.part_summaries WHERE id=$1 AND "deletedAt" IS NULL FOR UPDATE', [summaryId],
        ) as Array<{ id: string; number: string; revision: string }>;
        if (!summary) throw new NotFoundException('Part summary not found');
        await lockSummaryRequirements(manager, summaryId);

        const sets: string[] = [];
        const params: unknown[] = [summaryId, userId];
        const set = (column: string, value: unknown) => { params.push(value); sets.push(`${column}=$${params.length}`); };
        if (dto.number !== undefined) set('number', dto.number.trim());
        if (dto.revision !== undefined) set('revision', dto.revision.trim());
        if (dto.model_id !== undefined) {
          if (dto.model_id) {
            const [model] = await manager.query('SELECT id FROM public.models WHERE id=$1', [dto.model_id]);
            if (!model) throw new UnprocessableEntityException('Model not found');
          }
          set('model_id', dto.model_id || null);
        }
        if (dto.hos !== undefined) set('hos', dto.hos?.trim() || null);
        if (sets.length) {
          const number = dto.number?.trim() ?? summary.number;
          const revision = dto.revision?.trim() ?? summary.revision;
          const [duplicate] = await manager.query(
            'SELECT id FROM public.part_summaries WHERE number=$1 AND revision=$2 AND id<>$3', [number, revision, summaryId],
          );
          if (duplicate) throw new ConflictException(`Part Summary ${number}${revision ? ` revision ${revision}` : ''} already exists`);
          await manager.query(`UPDATE public.part_summaries SET ${sets.join(', ')}, "updatedAt"=now(), "updatedBy"=$2 WHERE id=$1`, params);
        }

        for (const [code, group] of groups) {
          const [partType] = await manager.query('SELECT id FROM public.part_types WHERE code=$1', [code]);
          if (!partType) throw new UnprocessableEntityException(`Part Type ${code} is not configured`);
          const [current] = await manager.query(
            'SELECT hos, inner_blade, outer_blade FROM public.part_summary_part_type_blades WHERE summary_id=$1 AND part_type_id=$2 FOR UPDATE',
            [summaryId, partType.id],
          ) as Array<{ hos: string | null; inner_blade: string | null; outer_blade: string | null }>;
          const next = {
            hos: group.hos !== undefined ? normalizeSummaryHos(group.hos) : current?.hos ?? null,
            inner_blade: group.inner_blade !== undefined ? normalizeBladeLabel(group.inner_blade) : current?.inner_blade ?? null,
            outer_blade: group.outer_blade !== undefined ? normalizeBladeLabel(group.outer_blade) : current?.outer_blade ?? null,
          };
          if (!current && next.hos === null && next.inner_blade === null && next.outer_blade === null) continue;
          await manager.query(
            `INSERT INTO public.part_summary_part_type_blades
               (summary_id, part_type_id, hos, inner_blade, outer_blade, source, "createdBy", "updatedBy")
             VALUES ($1,$2,$3,$4,$5,'ADMIN',$6,$6)
             ON CONFLICT (summary_id, part_type_id) DO UPDATE
               SET hos=EXCLUDED.hos, inner_blade=EXCLUDED.inner_blade, outer_blade=EXCLUDED.outer_blade,
                   source='ADMIN', "updatedAt"=now(), "updatedBy"=EXCLUDED."updatedBy"`,
            [summaryId, partType.id, next.hos, next.inner_blade, next.outer_blade, userId],
          );
        }

        if (dto.body_rule === null) {
          await manager.query('DELETE FROM public.cutter_summary_body_rules WHERE summary_id=$1', [summaryId]);
        } else if (rule) {
          return applySummaryBodyRule(manager, summaryId, rule.code, userId);
        }
        return undefined;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('A Part Summary with this number and revision already exists');
      throw error;
    }
    const [row] = await this.listPartSummarySettings(summaryId);
    return openTrays === undefined ? row : { ...row, open_trays_with_other_quantity: openTrays };
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

    const bodyCheck = dto.cutter_body_identifier?.trim()
      ? await this.checkBodyForRequirement(
        dto.cutter_body_identifier,
        requirement.required_blade_count,
        requirement.part_type?.code ?? null,
        await readSummaryBodyRule(this.requirementRepo.manager, dto.summary_id),
      )
      : null;

    const valid =
      (bodyCheck ? bodyCheck.compatible && bodyCheck.available : true) &&
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
    if (bodyCheck && !bodyCheck.compatible) reasons.push(`Cutter body does not match this tray requirement: ${bodyCheck.reason}`);
    if (bodyCheck && bodyCheck.compatible && !bodyCheck.available) reasons.push(bodyCheck.availability_reason ?? 'Cutter body is not available');

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
      ...(bodyCheck ? {
        cutter_body_id: bodyCheck.body_id,
        body_compatible: bodyCheck.compatible,
        body_rule: bodyCheck.body_rule,
        body_reason: bodyCheck.reason,
        body_available: bodyCheck.available,
        body_availability_reason: bodyCheck.availability_reason,
      } : {}),
      reason: valid ? undefined : reasons.join('; '),
    };
  }

  /**
   * Type compatibility (the shared rule) and physical availability, kept apart, for the body
   * an operator scanned. The same evaluation the build itself runs, with the body's definition.
   */
  private async checkBodyForRequirement(identifier: string, requiredSets: number, partTypeCode: string | null, summaryRule: string | null) {
    const serial = identifier.trim().toUpperCase();
    const rows: Array<BodyWithDefinitionRow & { open_build: boolean }> = await this.requirementRepo.manager.query(
      `${BODY_WITH_DEFINITION_SQL}
         AND (UPPER(b.dana_serial_number)=$1 OR UPPER(b.mf_serial_number)=$1)`,
      [serial],
    );
    const danaMatch = rows.find((row) => row.dana_serial_number?.toUpperCase() === serial);
    const row = danaMatch ?? (rows.length === 1 ? rows[0] : null);
    if (!row) {
      return {
        body_id: null, compatible: false, body_rule: null, available: false, availability_reason: null,
        reason: rows.length ? `Manufacturer serial ${serial} matches multiple cutter bodies. Enter the Dana serial number.` : `No enabled cutter body has Dana or MF serial ${serial}`,
      };
    }
    const result = evaluateCutterBodyCompatibility(toBodyModel(row), requiredSets, partTypeCode, summaryRule);
    return {
      body_id: row.id,
      compatible: result.compatible,
      body_rule: result.body_rule?.code ?? null,
      reason: result.reason,
      available: !row.open_build,
      availability_reason: row.open_build ? `Cutter body ${row.dana_serial_number || row.mf_serial_number} already has an open build` : null,
    };
  }

  /**
   * Summary + Part Type → permitted cutter-body definitions, from the configured requirements,
   * Body Size Rules and enabled definitions. Type compatibility only: whether a particular
   * physical body is free is answered by availability and the build check.
   */
  async listBodyCompatibilityMatrix(summaryId: string | null): Promise<CutterBodyMatrixRow[]> {
    const [summaries, definitions] = await Promise.all([
      this.readMatrixSummaries(summaryId),
      this.readDefinitions(),
    ]);
    return buildCutterBodyCompatibilityMatrix(summaries, definitions);
  }

  private async readDefinitions(): Promise<CutterBodyDefinitionCodes[]> {
    return this.requirementRepo.manager.query(`
      SELECT id, definition_code, cutter_head_code, supplier_code, hand_code, blade_family_code, blade_family_name, size_code, enabled
        FROM public.cutter_body_definitions WHERE "deletedAt" IS NULL ORDER BY definition_code`);
  }

  private async readMatrixSummaries(summaryId: string | null): Promise<CutterBodyMatrixSummaryInput[]> {
    const rows: Array<CutterBodyMatrixSummaryInput & { body_rule: string | null; requirements: CutterBodyMatrixSummaryInput['requirements'] | null }> =
      await this.requirementRepo.manager.query(`
      SELECT s.id AS summary_id, s.number AS summary_number, s.revision AS summary_revision, s.enabled AS summary_enabled,
             m.model_number::text AS model_number, s.hos, r.body_rule,
             (SELECT json_agg(json_build_object('part_type_code', pt.code, 'required_blade_count', q.required_blade_count,
                       'enabled', q.enabled AND pt.enabled, 'part_type_hos', b.hos, 'inner_blade', b.inner_blade,
                       'outer_blade', b.outer_blade) ORDER BY pt.code)
                FROM public.cutter_blade_requirements q JOIN public.part_types pt ON pt.id=q.part_type_id
                LEFT JOIN public.part_summary_part_type_blades b ON b.summary_id=q.summary_id AND b.part_type_id=q.part_type_id
               WHERE q.summary_id=s.id AND q."deletedAt" IS NULL) AS requirements
        FROM public.part_summaries s
        LEFT JOIN public.models m ON m.id=s.model_id
        LEFT JOIN public.cutter_summary_body_rules r ON r.summary_id=s.id
       WHERE s."deletedAt" IS NULL AND ($1::uuid IS NULL OR s.id=$1::uuid)
       ORDER BY s.number, s.revision`, [summaryId]);
    return rows.map((row) => ({
      ...row,
      configured_body_rule: row.body_rule,
      requirements: (row.requirements ?? []).map((r) => ({ ...r, required_blade_count: Number(r.required_blade_count) })),
    }));
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

/** Set a Summary's Body Size Rule and move its RING/PINION requirement rows to the rule's quantity. */
async function applySummaryBodyRule(manager: EntityManager, summaryId: string, ruleCode: string, userId: string): Promise<number> {
  const rule = cutterBodyRuleByCode(ruleCode);
  if (!rule) throw new UnprocessableEntityException(`Body Size Rule must be one of ${CUTTER_BODY_RULES.map((r) => r.code).join(', ')}`);
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
}, definitions: readonly CutterBodyDefinitionCodes[] = []): ISummaryBodyRuleRow {
  const requirements = (row.requirements ?? []).map((r) => ({ ...r, required_blade_count: Number(r.required_blade_count) }));
  const state = summaryBodyRuleState(row.body_rule, requirements.map((r) => r.required_blade_count));
  const usable = state.status === 'CONFIGURED' || state.status === 'DERIVED' ? state.effective_rule : null;
  const permitted = [...new Set(requirements.flatMap((r) =>
    permittedCutterBodyDefinitions(usable, r.part_type_code, definitions).map((d) => d.definition_code)))].sort();
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
    permitted_body_definitions: permitted,
    requirements,
  };
}

/** A body with its definition columns, as the build check and the matrix read them. */
interface BodyWithDefinitionRow {
  id: string; dana_serial_number: string | null; mf_serial_number: string | null; enabled: boolean;
  definition_id: string | null; definition_code: string | null; cutter_head_code: string | null; supplier_code: string | null;
  hand_code: string | null; blade_family_code: string | null; blade_family_name: string | null; size_code: string | null;
  definition_enabled: boolean | null;
}

const BODY_WITH_DEFINITION_SQL = `
  SELECT b.id, b.dana_serial_number, b.mf_serial_number, b.enabled, d.id AS definition_id, d.definition_code,
         d.cutter_head_code, d.supplier_code, d.hand_code, d.blade_family_code, d.blade_family_name, d.size_code,
         d.enabled AS definition_enabled,
         EXISTS (SELECT 1 FROM public.cutter_builds ob WHERE ob.cutter_body_id=b.id AND ob.completed_at IS NULL) AS open_build
    FROM public.cutter_bodies b
    LEFT JOIN public.cutter_body_definitions d ON d.id=b.definition_id
   WHERE b."deletedAt" IS NULL AND b.enabled=true`;

function toBodyModel(row: BodyWithDefinitionRow) {
  return {
    dana_serial_number: row.dana_serial_number,
    mf_serial_number: row.mf_serial_number,
    definition: row.definition_id ? {
      id: row.definition_id, definition_code: row.definition_code, cutter_head_code: row.cutter_head_code,
      supplier_code: row.supplier_code, hand_code: row.hand_code, blade_family_code: row.blade_family_code,
      blade_family_name: row.blade_family_name, size_code: row.size_code, enabled: row.definition_enabled,
    } : null,
  };
}

const isGearsetType = (code: string | null | undefined) =>
  code?.trim().toUpperCase() === 'GEARSET';
