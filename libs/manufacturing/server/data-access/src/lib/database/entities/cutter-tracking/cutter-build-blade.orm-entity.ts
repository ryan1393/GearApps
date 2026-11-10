import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AbstractOrmEntity } from '@gearapps/manufacturing/server/util-common';
import { ICutterBuildBlade } from '@gearapps/manufacturing/shared/util-types';
import { BladeOrmEntity } from '../blade-tracking/blade.orm-entity';
import { CutterBuildOrmEntity } from './cutter-build.orm-entity';
@Entity({ name: 'cutter_build_blades' })
@Index(['cutter_build_id', 'blade_id'], { unique: true })
@Index('uq_cutter_build_blades_active_blade', ['blade_id'], {
  unique: true,
  where: '"enabled" = true',
})
export class CutterBuildBladeOrmEntity extends AbstractOrmEntity {
  @Column({ type: String }) cutter_build_id!: string;
  @Column({ type: String }) blade_id!: string;
  @Column({ type: Number, nullable: true }) position!: number | null;
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }) installed_at!: Date;
  @Column({ type: 'timestamp', nullable: true }) removed_at!: Date | null;
  @Column({ type: Boolean, default: true }) enabled!: boolean;
  @ManyToOne(() => CutterBuildOrmEntity, { nullable: false }) @JoinColumn({ name: 'cutter_build_id' }) cutter_build!: CutterBuildOrmEntity;
  @ManyToOne(() => BladeOrmEntity, { nullable: false }) @JoinColumn({ name: 'blade_id' }) blade!: BladeOrmEntity;
  public override toJSON(): ICutterBuildBlade { return instanceToPlain(this) as ICutterBuildBlade; }
}
