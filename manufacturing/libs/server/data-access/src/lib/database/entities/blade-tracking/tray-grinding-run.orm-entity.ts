import { instanceToPlain } from 'class-transformer';
import { Check, Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@libs/server/util-common';
import { ITrayGrindingRun } from '@libs/shared/util-types';
import { PartSummaryOrmEntity } from '../base/part-summary.orm-entity';
import { CutterPartTypeOrmEntity } from '../cutter-tracking/cutter-part-type.orm-entity';
import { UserOrmEntity } from '../user.orm-entity';
import { TrayOrmEntity } from './tray.orm-entity';

@Entity({ name: 'tray_grinding_runs' })
@Check('"starting_blade_count" >= 0')
@Check('"returned_blade_count" >= 0')
@Check('"scrapped_blade_count" >= 0')
@Check('"required_blade_count" >= 0')
@Check('"returned_blade_count" + "scrapped_blade_count" = "starting_blade_count"')
export class TrayGrindingRunOrmEntity extends AbstractOrmEntity {
  @Column({ type: String })
  tray_id!: string;

  @Column({ type: String })
  summary_id!: string;

  @Column({ type: String })
  part_type_id!: string;

  @Column({ type: Number })
  starting_blade_count!: number;

  @Column({ type: Number })
  returned_blade_count!: number;

  @Column({ type: Number })
  scrapped_blade_count!: number;

  @Column({ type: Number })
  required_blade_count!: number;

  @Column({ type: String, nullable: true })
  completed_by_user_id!: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  completed_at!: Date;

  @ManyToOne(() => TrayOrmEntity, { nullable: false })
  @JoinColumn({ name: 'tray_id' })
  tray!: TrayOrmEntity;

  @ManyToOne(() => PartSummaryOrmEntity, { nullable: false })
  @JoinColumn({ name: 'summary_id' })
  summary!: PartSummaryOrmEntity;

  @ManyToOne(() => CutterPartTypeOrmEntity, { nullable: false })
  @JoinColumn({ name: 'part_type_id' })
  part_type!: CutterPartTypeOrmEntity;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'completed_by_user_id' })
  completed_by_user!: UserOrmEntity | null;

  public override toJSON(): ITrayGrindingRun {
    return instanceToPlain(this) as ITrayGrindingRun;
  }
}
