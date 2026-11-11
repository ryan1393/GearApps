import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import { ICutterBuildLocation } from '@meshforge/manufacturing/shared/util-types';
import { LocationOrmEntity } from '../blade-tracking/location.orm-entity';
import { CutterBuildOrmEntity } from './cutter-build.orm-entity';

@Entity({ name: 'cutter_build_locations' })
@Index('uq_cutter_build_locations_active_build', ['cutter_build_id'], {
  unique: true,
  where: '"enabled" = true',
})
export class CutterBuildLocationOrmEntity extends AbstractOrmEntity {
  @Column({ type: String })
  cutter_build_id!: string;

  @Column({ type: String })
  location_id!: string;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  placed_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  removed_at!: Date | null;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  @ManyToOne(() => CutterBuildOrmEntity, { nullable: false })
  @JoinColumn({ name: 'cutter_build_id' })
  cutter_build!: CutterBuildOrmEntity;

  @ManyToOne(() => LocationOrmEntity, { nullable: false })
  @JoinColumn({ name: 'location_id' })
  location!: LocationOrmEntity;

  public override toJSON(): ICutterBuildLocation {
    return instanceToPlain(this) as ICutterBuildLocation;
  }
}
