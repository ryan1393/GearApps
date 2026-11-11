import { randomUUID } from 'node:crypto';
import { COATER_SHIPMENT_SCHEMA } from './coater-shipment.schema';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { STARTUP_SCHEMA_LOCK_SQL } from '@meshforge/manufacturing/shared/util-constants';
import { CUTTER_BODY_SHELF_SCHEMA } from './cutter-body-shelf.schema';
import { applySharedDatabaseIntegrity } from '@meshforge/shared/database';

/**
 * Additive schema evolution for MeshForge master-data features that must work
 * against the existing production database with DATABASE_SYNCHRONIZE=false.
 * Every statement is idempotent. Existing rows and history are preserved.
 */
@Injectable()
export class GearMasterDataBootstrap implements OnModuleInit {
  private readonly logger = new Logger(GearMasterDataBootstrap.name);

  constructor(@InjectDataSource() private readonly source: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.source.transaction(async (manager) => {
      await manager.query(STARTUP_SCHEMA_LOCK_SQL);
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtext('dana-gear-master-data-v1'))",
      );

      await manager.query(`
        ALTER TABLE public.users
          ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" character varying,
          ADD COLUMN IF NOT EXISTS "passwordResetExpiresAt" timestamp,
          ADD COLUMN IF NOT EXISTS "authVersion" integer NOT NULL DEFAULT 0;

        ALTER TABLE public.machines
          ADD COLUMN IF NOT EXISTS machine_type text NOT NULL DEFAULT 'PRODUCTION';
        CREATE INDEX IF NOT EXISTS ix_machines_cutter_builder_eligibility
          ON public.machines (department_id, machine_type, enabled, active);

        ALTER TABLE public.trays ADD COLUMN IF NOT EXISTS current_grinding_machine_id uuid REFERENCES public.machines(id);
        ALTER TABLE public.tray_grinding_runs
          ADD COLUMN IF NOT EXISTS grinding_machine_id uuid REFERENCES public.machines(id),
          ADD COLUMN IF NOT EXISTS grinding_machine_number text;
        CREATE INDEX IF NOT EXISTS ix_tray_grinding_runs_machine ON public.tray_grinding_runs(grinding_machine_id, completed_at DESC);

        ALTER TABLE public.roll_masters
          ADD COLUMN IF NOT EXISTS current_quantity integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS minimum_quantity integer NOT NULL DEFAULT 0;
        UPDATE public.roll_masters
           SET minimum_quantity = required_count
         WHERE minimum_quantity = 0 AND required_count > 0;

        ALTER TABLE public.cutter_builds
          ADD COLUMN IF NOT EXISTS cutter_builder_machine_id uuid;
        CREATE INDEX IF NOT EXISTS ix_cutter_builds_builder_machine
          ON public.cutter_builds (cutter_builder_machine_id);

        -- What a location holds, for its summary tag. Optional; existing locations stay blank.
        ALTER TABLE public.locations
          ADD COLUMN IF NOT EXISTS summary_id uuid REFERENCES public.part_summaries(id),
          ADD COLUMN IF NOT EXISTS part_type_id uuid REFERENCES public.part_types(id);


      `);
      await manager.query(CUTTER_BODY_SHELF_SCHEMA);
      await manager.query(COATER_SHIPMENT_SCHEMA);
      await manager.query(`INSERT INTO tray_stages(id,code,name,description,sort_order,enabled)
        VALUES($1,'PACKED_FOR_COATER','Packed for Coater','Loaded in a container; awaiting shipment dispatch',35,true)
        ON CONFLICT(code) DO NOTHING`, [randomUUID()]);
      // Numbered CGRR-### / CGRP-### shelves are configured through Admin, just
      // like the other physical numbered locations. Do not invent a shelf count,
      // rename CGRR/CGRP to an assumed slot, or move historical/current placements.
      await applySharedDatabaseIntegrity(manager);
    });
    this.logger.log('Gear master-data schema verified');
  }
}
