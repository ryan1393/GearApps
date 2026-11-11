import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CutterBuildStatusOrmEntity } from '../entities/cutter-tracking/cutter-build-status.orm-entity';
import { CutterEventTypeOrmEntity } from '../entities/cutter-tracking/cutter-event-type.orm-entity';
import { CutterPartTypeOrmEntity } from '../entities/cutter-tracking/cutter-part-type.orm-entity';
import { CutterPullReasonOrmEntity } from '../entities/cutter-tracking/cutter-pull-reason.orm-entity';
import { CutterCheckResultOrmEntity } from '../entities/cutter-tracking/cutter-check-result.orm-entity';
import { TrayStageOrmEntity } from '../entities/blade-tracking/tray-stage.orm-entity';

/** PostgreSQL form of LOCATION_PART_TYPE_PATTERN in util-constants: captures the R or P. */
export const LOCATION_PART_TYPE_SQL_PATTERN = '^(?:GS|CG[RDF])([RP])(?:-|$)';

@Injectable()
export class CutterReferenceBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CutterReferenceBootstrapService.name);

  constructor(
    @InjectRepository(CutterEventTypeOrmEntity)
    private readonly eventTypeRepo: Repository<CutterEventTypeOrmEntity>,
    @InjectRepository(CutterBuildStatusOrmEntity)
    private readonly buildStatusRepo: Repository<CutterBuildStatusOrmEntity>,
    @InjectRepository(CutterPartTypeOrmEntity)
    private readonly partTypeRepo: Repository<CutterPartTypeOrmEntity>,
    @InjectRepository(TrayStageOrmEntity)
    private readonly trayStageRepo: Repository<TrayStageOrmEntity>,
    @InjectRepository(CutterPullReasonOrmEntity)
    private readonly pullReasonRepo: Repository<CutterPullReasonOrmEntity>,
    @InjectRepository(CutterCheckResultOrmEntity)
    private readonly checkResultRepo: Repository<CutterCheckResultOrmEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await Promise.all([
      this.upsertEventTypes(),
      this.upsertBuildStatuses(),
      this.upsertPartTypes(),
      this.upsertTrayStages(),
      this.upsertPullReasons(),
      this.upsertCheckResults(),
    ]);
    await this.alignLocationPartTypes();

    this.logger.log('Cutter reference data verified');
  }

  /**
   * A shelf's part type is the R or P in its barcode (GSR/GSP, CGRR/CGRP, CGDR/CGDP, CGFR/CGFP;
   * see locationPartTypeFromSerial). Locations saved before that rule, or with a hand-picked part
   * type that disagrees, are corrected once here; locations whose barcode names none are untouched.
   */
  private async alignLocationPartTypes(): Promise<void> {
    const rows = (await this.partTypeRepo.manager.query(
      `WITH aligned AS (
         UPDATE locations AS location
            SET part_type_id = part_type.id
           FROM part_types AS part_type
          WHERE part_type.enabled = true
            AND part_type.code = CASE substring(upper(btrim(location.serial_number)) FROM $1)
                                   WHEN 'R' THEN $2 WHEN 'P' THEN $3 END
            AND location.part_type_id IS DISTINCT FROM part_type.id
        RETURNING location.serial_number
       )
       SELECT serial_number FROM aligned ORDER BY serial_number`,
      [LOCATION_PART_TYPE_SQL_PATTERN, 'RING', 'PINION'],
    )) as Array<{ serial_number: string }>;
    if (rows.length) {
      this.logger.log(`Set the part type of ${rows.length} location(s) from their barcode: ${rows.map((row) => row.serial_number).join(', ')}`);
    }
  }

  private async upsertEventTypes(): Promise<void> {
    const rows = [
      ['CB', 'Cutter Build', 'Cutter Builder build or rebuild', 10],
      ['CS', 'Cutter Setup', 'Cutter setup on a production machine', 20],
      ['FC', 'Frequency Check', 'Periodic production quality check', 30],
      ['CMM', 'CMM Check', 'CMM / Zeiss quality check', 40],
      ['CP', 'Cutter Pull', 'Cutter removed for dull, damage, or other pull reason', 50],
      ['CC', 'Changeover', 'Usable cutter removed for changeover and returned to shelf', 60],
      ['TD', 'Cutter Teardown', 'Cutter Builder teardown and blade disposition', 70],
    ] as const;

    for (const [code, name, description, sort_order] of rows) {
      const existing = await this.eventTypeRepo.findOne({ where: { code } });
      if (existing) continue;
      await this.eventTypeRepo.save(
        this.eventTypeRepo.create({
          code,
          name,
          description,
          sort_order,
          enabled: true,
        }),
      );
    }
  }

  private async upsertBuildStatuses(): Promise<void> {
    const rows = [
      ['BUILDING', 'Building', 'Currently being assembled in Cutter Builder', 10],
      ['READY', 'Ready', 'Built and available for setup', 20],
      ['RUNNING', 'Running', 'Currently installed on a machine', 30],
      ['SHELF', 'Shelf', 'Usable build returned to shelf after changeover', 40],
      ['PULLED', 'Pulled', 'Removed and awaiting Cutter Builder disposition', 50],
      ['CLOSED', 'Closed', 'Build cycle complete; body is ready for rebuild', 60],
    ] as const;

    for (const [code, name, description, sort_order] of rows) {
      const existing = await this.buildStatusRepo.findOne({ where: { code } });
      if (existing) continue;
      await this.buildStatusRepo.save(
        this.buildStatusRepo.create({
          code,
          name,
          description,
          sort_order,
          enabled: true,
        }),
      );
    }
  }



  private async upsertPullReasons(): Promise<void> {
    // Generic fallback reasons for a database that has none. Once the plant's own
    // reasons are imported (tools/base-data, which deletes these generic codes),
    // do not re-create them on every API start.
    if ((await this.pullReasonRepo.count()) > 0) return;
    const rows = [
      ['DULL', 'Dull', 'Cutter is dull and must return to Cutter Builder for teardown/rebuild', true, false, 10],
      ['DAMAGED', 'Damaged', 'Cutter or blade damage requires Cutter Builder teardown/rebuild', true, false, 20],
      ['CHANGEOVER', 'Changeover', 'Usable cutter removed for changeover and returned to a Greenshed shelf', false, true, 30],
      ['QUALITY', 'Quality Issue', 'Cutter pulled because of a quality concern', true, false, 40],
      ['OTHER', 'Other', 'Other pull reason requiring Cutter Builder disposition', true, false, 50],
    ] as const;

    for (const [code, name, description, requires_teardown, returns_to_shelf, sort_order] of rows) {
      const existing = await this.pullReasonRepo.findOne({ where: { code } });
      if (existing) continue;
      await this.pullReasonRepo.save(
        this.pullReasonRepo.create({
          code,
          name,
          description,
          requires_teardown,
          returns_to_shelf,
          sort_order,
          enabled: true,
        }),
      );
    }
  }

  private async upsertCheckResults(): Promise<void> {
    const rows = [
      ['PASS', 'Pass', 'Quality check passed', 10],
      ['FAIL', 'Fail', 'Quality check failed', 20],
      ['HOLD', 'Hold', 'Quality check requires review before continuing', 30],
    ] as const;

    for (const [code, name, description, sort_order] of rows) {
      const existing = await this.checkResultRepo.findOne({ where: { code } });
      if (existing) continue;
      await this.checkResultRepo.save(
        this.checkResultRepo.create({
          code,
          name,
          description,
          sort_order,
          enabled: true,
        }),
      );
    }
  }

  private async upsertTrayStages(): Promise<void> {
    const rows = [
      ['EMPTY', 'Empty', 'Empty reusable tray', 10],
      ['WAITING_FOR_GRINDING', 'Waiting for Grinding', 'Returned cutter blades stored on shelf before grinding', 20],
      ['GRINDING', 'Grinding', 'Tray is actively in Cutter Builder grinding/resharpening', 30],
      ['READY_FOR_COATING', 'Ready for Coating', 'Grinding complete and exact blade quantity enforced', 40],
      ['AT_COATER', 'At Coater', 'Tray is loaded for external coating', 50],
      ['READY_FOR_CUTTER', 'Ready for Cutter', 'Returned from coating and stored on shelf', 60],
    ] as const;

    for (const [code, name, description, sort_order] of rows) {
      const existing = await this.trayStageRepo.findOne({ where: { code } });
      if (existing) continue;
      await this.trayStageRepo.save(
        this.trayStageRepo.create({
          code,
          name,
          description,
          sort_order,
          enabled: true,
        }),
      );
    }
  }

  private async upsertPartTypes(): Promise<void> {
    const rows = [
      ['RING', 'Ring', 'Ring cutter / blade set', 10],
      ['PINION', 'Pinion', 'Pinion cutter / blade set', 20],
    ] as const;

    for (const [code, name, description, sort_order] of rows) {
      const existing = await this.partTypeRepo.findOne({ where: { code } });
      if (existing) continue;
      await this.partTypeRepo.save(
        this.partTypeRepo.create({
          code,
          name,
          description,
          sort_order,
          enabled: true,
        }),
      );
    }
  }
}
