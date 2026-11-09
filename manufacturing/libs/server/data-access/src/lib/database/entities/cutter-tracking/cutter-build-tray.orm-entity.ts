import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@libs/server/util-common';
import { TrayOrmEntity } from '../blade-tracking/tray.orm-entity';
import { CutterBuildOrmEntity } from './cutter-build.orm-entity';

@Entity({ name: 'cutter_build_trays' })
@Index('uq_cutter_build_trays_build', ['cutter_build_id'], {
  unique: true,
})
@Index('uq_cutter_build_trays_active_tray', ['tray_id'], {
  unique: true,
  where: '"enabled" = true',
})
export class CutterBuildTrayOrmEntity extends AbstractOrmEntity {
  @Column({ type: String })
  cutter_build_id!: string;

  @Column({ type: String })
  tray_id!: string;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  assigned_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  released_at!: Date | null;

  @ManyToOne(() => CutterBuildOrmEntity, { nullable: false })
  @JoinColumn({ name: 'cutter_build_id' })
  cutter_build!: CutterBuildOrmEntity;

  @ManyToOne(() => TrayOrmEntity, { nullable: false })
  @JoinColumn({ name: 'tray_id' })
  tray!: TrayOrmEntity;

  public override toJSON() {
    return instanceToPlain(this);
  }
}
