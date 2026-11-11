import { EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';

import {
  BladeTrayOrmEntity,
  CreateLocationDto,
  CutterBladeRequirementOrmEntity,
  CutterBuildLocationOrmEntity,
  CutterPartTypeOrmEntity,
  LocationOrmEntity,
  LocationTrayOrmEntity,
  PartSummaryOrmEntity,
  InventoryListQueryDto,
  PaginationService,
} from '@meshforge/manufacturing/server/data-access';
import {
  ILocationEntity,
  Uuid,
} from '@meshforge/manufacturing/shared/util-types';
import {
  CuttergrindNumberedShelfTag,
  CuttergrindRoughShelfTag,
  parseCuttergrindNumberedShelfTag,
  parseCuttergrindRoughShelfTag,
  parseSummaryShelfTag,
  SummaryShelfTag,
} from '@meshforge/manufacturing/shared/util-constants';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

/** What a location holds: shown in its details and printed on its summary tag. */
const LOCATION_CONTENTS = { summary: true, part_type: true } as const;

@Injectable()
export class ServerFeatLocationService extends PaginationService<LocationOrmEntity> {
  private readonly logger = new Logger(ServerFeatLocationService.name);

  constructor(
    @InjectRepository(LocationOrmEntity)
    private readonly locationRepo: Repository<LocationOrmEntity>,
    @InjectRepository(PartSummaryOrmEntity)
    private readonly partSummaryRepo: Repository<PartSummaryOrmEntity>,
  ) {
    super(LocationOrmEntity.prototype, locationRepo);
  }

  async findLocation(
    find: FindOptionsWhere<LocationOrmEntity>,
  ): Promise<LocationOrmEntity | null> {
    return this.locationRepo.findOneBy(find);
  }

  async createLocation(dto: CreateLocationDto, userId: Uuid): Promise<LocationOrmEntity> {
    const serialNumber = dto.serial_number.trim().toUpperCase();
    const existing = await this.locationRepo.findOne({
      where: { serial_number: serialNumber },
    });
    if (existing) {
      throw new ConflictException(`Location barcode ${dto.serial_number} already exists`);
    }

    const roughShelf = parseCuttergrindRoughShelfTag(serialNumber);
    const numberedShelf = roughShelf ? null : parseCuttergrindNumberedShelfTag(serialNumber);
    const shelfTag = roughShelf || numberedShelf ? null : parseSummaryShelfTag(serialNumber);
    if (shelfTag) {
      await this.assertSummaryShelfReferences(shelfTag);
    }

    const normalizedDepartment =
      roughShelf?.department ??
      numberedShelf?.department ??
      shelfTag?.department ??
      (dto.department?.trim().toUpperCase() || null);
    const normalizedLocationType =
      roughShelf?.locationType ??
      numberedShelf?.locationType ??
      shelfTag?.locationType ??
      (dto.location_type?.trim().toUpperCase() || 'INTERNAL');
    this.assertSummaryShelfTagConvention(
      serialNumber,
      normalizedDepartment,
      normalizedLocationType,
      shelfTag,
      numberedShelf,
      roughShelf,
    );

    const contents = await this.resolveContents(this.locationRepo.manager, dto, shelfTag);

    const saved = await this.locationRepo.save(
      this.locationRepo.create({
        ...dto,
        ...contents,
        serial_number: serialNumber,
        number: roughShelf?.shelfNumber ?? numberedShelf?.shelfNumber ?? shelfTag?.summaryNumber ?? dto.number.trim(),
        department: normalizedDepartment,
        location_type: normalizedLocationType,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
    return this.locationRepo.findOneOrFail({ where: { id: saved.id }, relations: LOCATION_CONTENTS });
  }

  async getLocation(locationId: Uuid) {
    return this.locationRepo.findOneOrFail({ where: { id: locationId }, relations: LOCATION_CONTENTS });
  }

  async getLocationBySerialNumber(serialNumber: string) {
    const location = await this.locationRepo.findOne({
      where: { serial_number: serialNumber.trim().toUpperCase(), enabled: true },
      relations: LOCATION_CONTENTS,
    });
    if (!location) {
      throw new NotFoundException(`Location ${serialNumber} could not be found`);
    }
    const assignments = await this.locationRepo.manager.getRepository(LocationTrayOrmEntity).find({
      where: { location_id: location.id, enabled: true },
      relations: { tray: { summary: true, part_type: true, current_stage: true } },
      order: { createdAt: 'ASC' },
    });
    const activeAssignments = assignments.filter(({ tray }) => tray.enabled);
    const trayIds = activeAssignments.map(({ tray_id }) => tray_id);
    const bladeAssignments = trayIds.length ? await this.locationRepo.manager.getRepository(BladeTrayOrmEntity).find({
      where: { tray_id: In(trayIds), enabled: true },
      relations: { blade: { summary: true, part_type: true } },
      order: { createdAt: 'ASC' },
    }) : [];
    const bladesByTray = new Map<string, BladeTrayOrmEntity[]>();
    for (const assignment of bladeAssignments) {
      if (!assignment.blade.enabled) continue;
      const rows = bladesByTray.get(assignment.tray_id) ?? []; rows.push(assignment); bladesByTray.set(assignment.tray_id, rows);
    }
    const trays = activeAssignments.map(({ tray }) => ({
      id: tray.id, serial_number: tray.serial_number, blade_count: tray.blade_count,
      summary_number: tray.summary?.number ?? null, part_type_code: tray.part_type?.code ?? null,
      stage_code: tray.current_stage?.code ?? null, stage_name: tray.current_stage?.name ?? null,
      blades: (bladesByTray.get(tray.id) ?? []).map(({ blade }) => ({
        id: blade.id, serial_number: blade.serial_number, status: blade.status, service_cycle: blade.service_cycle,
        summary_number: blade.summary?.number ?? null, part_type_code: blade.part_type?.code ?? null,
      })),
    }));
    return { ...location.toJSON(), tray_count: trays.length, blade_count: trays.reduce((total, tray) => total + Number(tray.blade_count ?? 0), 0), trays };
  }

  async getLocations(
    query?: InventoryListQueryDto,
  ) {
    const page = Math.max(query?.page ?? 1, 1);
    const perPage = Math.min(Math.max(query?.perPage ?? 50, 1), 50);
    const search = query?.search?.trim();

    const qb = this.locationRepo
      .createQueryBuilder('location')
      .leftJoinAndSelect('location.summary', 'summary')
      .leftJoinAndSelect('location.part_type', 'partType');

    if (search) {
      qb.andWhere(
        `(location.serial_number ILIKE :search
          OR location.number ILIKE :search
          OR location.description ILIKE :search
          OR location.department ILIKE :search
          OR location.location_type ILIKE :search
          OR summary.number ILIKE :search
          OR partType.code ILIKE :search)`,
        { search: `%${search}%` },
      );
    }

    const [items, totalItems] = await qb
      .orderBy('location.serial_number', 'ASC')
      .take(perPage)
      .skip((page - 1) * perPage)
      .getManyAndCount();

    const locationIds = items.map((item) => item.id);
    const assignments = locationIds.length
      ? await this.locationRepo.manager.getRepository(LocationTrayOrmEntity).find({
          where: {
            location_id: In(locationIds),
            enabled: true,
          },
          relations: {
            tray: {
              summary: true,
              part_type: true,
              current_stage: true,
            },
          },
          order: { createdAt: 'ASC' },
        })
      : [];

    const activeAssignments = assignments.filter(({ tray }) => tray.enabled);
    const trayIds = activeAssignments.map(({ tray_id }) => tray_id);
    const bladeAssignments = trayIds.length
      ? await this.locationRepo.manager.getRepository(BladeTrayOrmEntity).find({
          where: {
            tray_id: In(trayIds),
            enabled: true,
          },
          relations: {
            blade: {
              summary: true,
              part_type: true,
            },
          },
          order: { createdAt: 'ASC' },
        })
      : [];

    const bladesByTray = new Map<string, BladeTrayOrmEntity[]>();
    for (const assignment of bladeAssignments) {
      if (!assignment.blade.enabled) continue;
      const rows = bladesByTray.get(assignment.tray_id) ?? [];
      rows.push(assignment);
      bladesByTray.set(assignment.tray_id, rows);
    }

    const traysByLocation = new Map<string, LocationTrayOrmEntity[]>();
    for (const assignment of activeAssignments) {
      const rows = traysByLocation.get(assignment.location_id) ?? [];
      rows.push(assignment);
      traysByLocation.set(assignment.location_id, rows);
    }

    const totalPages = Math.max(Math.ceil(totalItems / perPage), 1);

    return {
      data: items.map((entity) => {
        const locationAssignments = traysByLocation.get(entity.id) ?? [];
        const trays = locationAssignments.map(({ tray }) => ({
          id: tray.id,
          serial_number: tray.serial_number,
          blade_count: tray.blade_count,
          summary_number: tray.summary?.number ?? null,
          part_type_code: tray.part_type?.code ?? null,
          stage_code: tray.current_stage?.code ?? null,
          stage_name: tray.current_stage?.name ?? null,
          blades: (bladesByTray.get(tray.id) ?? []).map(({ blade }) => ({
            id: blade.id,
            serial_number: blade.serial_number,
            status: blade.status,
            service_cycle: blade.service_cycle,
            summary_number: blade.summary?.number ?? null,
            part_type_code: blade.part_type?.code ?? null,
          })),
        }));

        return {
          ...entity.toJSON(),
          tray_count: trays.length,
          blade_count: trays.reduce(
            (total, tray) => total + Number(tray.blade_count ?? 0),
            0,
          ),
          trays,
        };
      }),
      meta: {
        page,
        perPage,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
        nextPage: page < totalPages ? String(page + 1) : null,
        previousPage: page > 1 ? String(page - 1) : null,
      },
    };
  }

  async updateLocation(locationId: Uuid, data: Partial<ILocationEntity>, userId: Uuid) {
    return this.locationRepo.manager.transaction(async (manager) => {
    const locationRepo = manager.getRepository(LocationOrmEntity);
    const existing = await locationRepo.findOneOrFail({ where: { id: locationId }, lock: { mode: 'pessimistic_write' } });
    const serialNumber =
      data.serial_number?.trim().toUpperCase() ?? existing.serial_number;

    if (serialNumber !== existing.serial_number) {
      const duplicate = await locationRepo.findOne({
        where: { serial_number: serialNumber },
      });
      if (duplicate) {
        throw new ConflictException(`Location barcode ${serialNumber} already exists`);
      }
    }

    const roughShelf = parseCuttergrindRoughShelfTag(serialNumber);
    const numberedShelf = roughShelf ? null : parseCuttergrindNumberedShelfTag(serialNumber);
    const shelfTag = roughShelf || numberedShelf ? null : parseSummaryShelfTag(serialNumber);
    if (shelfTag) {
      await this.assertSummaryShelfReferences(shelfTag);
    }

    const contents = await this.resolveContents(manager, data, shelfTag);

    const normalized = {
      ...data,
      ...contents,
      serial_number: data.serial_number === undefined ? undefined : serialNumber,
      number:
        roughShelf?.shelfNumber ??
        numberedShelf?.shelfNumber ??
        shelfTag?.summaryNumber ??
        data.number?.trim(),
      department:
        roughShelf?.department ??
        numberedShelf?.department ??
        shelfTag?.department ??
        (data.department === undefined
          ? undefined
          : data.department?.trim().toUpperCase() || null),
      location_type:
        roughShelf?.locationType ??
        numberedShelf?.locationType ??
        shelfTag?.locationType ??
        data.location_type?.trim().toUpperCase(),
    };

    this.assertSummaryShelfTagConvention(
      serialNumber,
      normalized.department === undefined ? existing.department : normalized.department,
      normalized.location_type === undefined
        ? existing.location_type
        : normalized.location_type,
      shelfTag,
      numberedShelf,
      roughShelf,
      serialNumber === existing.serial_number && /^(CGRR|CGRP)$/.test(serialNumber),
    );

    const identityOrRoutingChanged =
      (normalized.serial_number !== undefined && normalized.serial_number !== existing.serial_number) ||
      (normalized.number !== undefined && normalized.number !== existing.number) ||
      (normalized.department !== undefined && normalized.department !== existing.department) ||
      (normalized.location_type !== undefined && normalized.location_type !== existing.location_type);

    if (identityOrRoutingChanged) {
      await this.assertLocationHasNoActivePlacements(
        locationId,
        'Move all trays/cutters out of this location before changing its barcode or routing fields.', manager,
      );
    }

    if (normalized.enabled === false && existing.enabled) {
      await this.assertLocationHasNoActivePlacements(
        locationId,
        'Move all trays/cutters out of this location before disabling it.', manager,
      );
    }

    await locationRepo.save({
      id: locationId,
      ...normalized,
      updatedBy: userId,
    });
    return locationRepo.findOneOrFail({ where: { id: locationId }, relations: LOCATION_CONTENTS });
    });
  }

  /**
   * The Summary and part type a location holds. A GSR-/GSP- summary shelf names both in its
   * barcode, so they are always taken from there. Otherwise the chosen ones must exist and be
   * enabled; null clears one, and a field left out stays as it is.
   */
  private async resolveContents(
    manager: EntityManager,
    data: { summary_id?: string | null; part_type_id?: string | null },
    shelfTag: SummaryShelfTag | null,
  ): Promise<{ summary_id?: string | null; part_type_id?: string | null }> {
    const summaries = manager.getRepository(PartSummaryOrmEntity);
    const partTypes = manager.getRepository(CutterPartTypeOrmEntity);

    if (shelfTag) {
      const [summary] = await summaries.find({
        where: { number: shelfTag.summaryNumber, enabled: true },
        order: { active: 'DESC', revision: 'DESC' },
        take: 1,
      });
      const partType = await partTypes.findOne({ where: { code: shelfTag.partTypeCode, enabled: true } });
      return { summary_id: summary?.id ?? null, part_type_id: partType?.id ?? null };
    }

    const contents: { summary_id?: string | null; part_type_id?: string | null } = {};
    if (data.summary_id !== undefined) {
      if (data.summary_id && !(await summaries.exists({ where: { id: data.summary_id, enabled: true } }))) {
        throw new UnprocessableEntityException('The chosen Summary does not exist or is disabled');
      }
      contents.summary_id = data.summary_id || null;
    }
    if (data.part_type_id !== undefined) {
      if (data.part_type_id && !(await partTypes.exists({ where: { id: data.part_type_id, enabled: true } }))) {
        throw new UnprocessableEntityException('The chosen part type does not exist or is disabled');
      }
      contents.part_type_id = data.part_type_id || null;
    }
    return contents;
  }

  private assertSummaryShelfTagConvention(
    serialNumber: string,
    department: string | null | undefined,
    locationType: string | null | undefined,
    shelfTag: SummaryShelfTag | null,
    numberedShelf: CuttergrindNumberedShelfTag | null,
    roughShelf: CuttergrindRoughShelfTag | null,
    legacyExisting = false,
  ): void {
    const looksLikeSummaryShelf = /^(GSR|GSP)/.test(serialNumber);
    const looksLikeCuttergrindShelf = /^(CGDR|CGDP|CGFR|CGFP)-/.test(serialNumber);
    const looksLikeRoughShelf = /^(CGRR|CGRP)/.test(serialNumber);
    if (looksLikeSummaryShelf && !shelfTag) {
      throw new UnprocessableEntityException(
        `Summary shelf tags must use GSR-/GSP- for Green Shed or CGDR-/CGDP-/CGFR-/CGFP- for Cuttergrind, followed by the Summary`,
      );
    }

    if (
      department === 'GREENSHED' &&
      locationType === 'SHELF' &&
      shelfTag?.kind !== 'GREENSHED'
    ) {
      throw new UnprocessableEntityException(
        `Green Shed cutter shelves must use GSR-<summary> for RING or GSP-<summary> for PINION; ${serialNumber} is not a valid part-specific Green Shed shelf tag`,
      );
    }

    if (/^(CGDR|CGDP)-/.test(serialNumber) && !numberedShelf) {
      throw new UnprocessableEntityException(
        `Dull shelves use a shelf letter, layer number and bin letter, such as CGDR-A1A or CGDP-B2C (shelf, layer, bin); ${serialNumber} is invalid`,
      );
    }

    if (looksLikeCuttergrindShelf && !numberedShelf) {
      throw new UnprocessableEntityException(
        `Finished shelves must use a three-digit physical shelf number such as CGFR-001 or CGFP-001; ${serialNumber} is invalid`,
      );
    }

    if (
      department === 'CUTTERGRIND' &&
      locationType === 'SHELF' &&
      !numberedShelf &&
      !roughShelf &&
      !legacyExisting
    ) {
      throw new UnprocessableEntityException(
        `Cuttergrind shelves use CGRR-### / CGRP-### (rough), CGDR-A1A / CGDP-A1A (dull: shelf, layer, bin), or CGFR-### / CGFP-### (finished)`,
      );
    }

    if (looksLikeRoughShelf && !roughShelf && !legacyExisting) {
      throw new UnprocessableEntityException(`${serialNumber} is not a numbered rough shelf; use CGRR-001 or CGRP-001, for example`);
    }
  }

  private async assertSummaryShelfReferences(
    shelfTag: SummaryShelfTag,
  ): Promise<void> {
    const exists = await this.partSummaryRepo.exists({
      where: { number: shelfTag.summaryNumber, enabled: true },
    });
    if (!exists) {
      throw new UnprocessableEntityException(
        `Summary ${shelfTag.summaryNumber} does not exist or is disabled`,
      );
    }

    const requirementCount = await this.locationRepo.manager
      .getRepository(CutterBladeRequirementOrmEntity)
      .createQueryBuilder('requirement')
      .innerJoin('requirement.summary', 'summary')
      .innerJoin('requirement.part_type', 'partType')
      .where('requirement.enabled = :enabled', { enabled: true })
      .andWhere('summary.enabled = :summaryEnabled', { summaryEnabled: true })
      .andWhere('summary.number = :summaryNumber', {
        summaryNumber: shelfTag.summaryNumber,
      })
      .andWhere('partType.enabled = :partTypeEnabled', { partTypeEnabled: true })
      .andWhere('partType.code = :partTypeCode', {
        partTypeCode: shelfTag.partTypeCode,
      })
      .getCount();

    if (requirementCount < 1) {
      throw new UnprocessableEntityException(
        `Summary ${shelfTag.summaryNumber} does not have an enabled ${shelfTag.partTypeCode} blade requirement, so ${shelfTag.serialNumber} cannot be used as a ${shelfTag.department === 'GREENSHED' ? 'Green Shed' : 'Cuttergrind'} shelf`,
      );
    }
  }

  private async assertLocationHasNoActivePlacements(
    locationId: Uuid,
    message: string,
    manager = this.locationRepo.manager,
  ): Promise<void> {
    const [trayCount, cutterCount, bodyPlacements] = await Promise.all([
      manager.getRepository(LocationTrayOrmEntity).count({
        where: { location_id: locationId, enabled: true },
      }),
      manager.getRepository(CutterBuildLocationOrmEntity).count({
        where: { location_id: locationId, enabled: true },
      }),
      manager.query(
        'SELECT id FROM cutter_body_shelf_placements WHERE location_id=$1 AND enabled=true', [locationId],
      ),
    ]);

    if (trayCount || cutterCount || bodyPlacements.length) {
      throw new ConflictException(
        `${message} Active placements: ${trayCount} tray(s), ${cutterCount} cutter(s).`,
      );
    }
  }

  async deleteLocation(locationId: Uuid, userId: Uuid): Promise<void> {
    // Retiring an unused legacy barcode must not require its old routing to
    // satisfy today's placement convention. Only new/changed routing does.
    await this.locationRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(LocationOrmEntity);
      const location = await repo.findOne({ where: { id: locationId }, lock: { mode: 'pessimistic_write' } });
      if (!location) throw new UnprocessableEntityException('Error deleting location');
      await this.assertLocationHasNoActivePlacements(locationId, 'Move all trays/cutters out of this location before disabling it.', manager);
      location.enabled = false;
      location.updatedBy = userId;
      await repo.save(location);
    });
  }

}
