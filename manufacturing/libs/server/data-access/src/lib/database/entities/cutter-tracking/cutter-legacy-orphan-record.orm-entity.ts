import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index } from 'typeorm';

import { AbstractOrmEntity } from '@gearapps/manufacturing/server/util-common';

@Entity({ name: 'cutter_legacy_orphan_records' })
@Index(['source_type', 'legacy_check_id'])
export class CutterLegacyOrphanRecordOrmEntity extends AbstractOrmEntity {
  @Column({ type: String })
  source_type!: string;

  @Column({ type: String, nullable: true })
  legacy_check_id!: string | null;

  @Column({ type: String, nullable: true })
  legacy_build_id!: string | null;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  public override toJSON(): Record<string, unknown> {
    return instanceToPlain(this);
  }
}
