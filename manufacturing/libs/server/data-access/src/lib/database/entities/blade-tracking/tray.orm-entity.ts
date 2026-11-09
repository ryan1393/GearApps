import { instanceToPlain } from 'class-transformer';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@gearapps/manufacturing/server/util-common';
import { ITray, ITrayEntity } from '@gearapps/manufacturing/shared/util-types';
import { TrayDto, TrayDtoOptions } from '../../../dtos';
import { PartSummaryOrmEntity } from '../base/part-summary.orm-entity';
import { CutterPartTypeOrmEntity } from '../cutter-tracking/cutter-part-type.orm-entity';
import { TrayStageOrmEntity } from './tray-stage.orm-entity';
import { UserOrmEntity } from '../user.orm-entity';

@Entity({ name: 'trays' })
export class TrayOrmEntity
  extends AbstractOrmEntity<TrayDto, TrayDtoOptions>
  implements ITrayEntity {
  @Column({ nullable: false, type: String, unique: true })
  serial_number!: string;

  /**
   * Current physical count. This is synchronized from active blade-tray assignments.
   */
  @Column({ type: Number, default: 0 })
  blade_count!: number;

  /**
   * Assigned when the empty tray first receives blades. Locked while the tray contains blades.
   */
  @Column({ type: String, nullable: true })
  summary_id!: string | null;

  @Column({ type: String, nullable: true })
  part_type_id!: string | null;

  /**
   * Null while the tray is still in grinding.
   */
  @Column({ type: 'timestamp', nullable: true })
  grinding_completed_at!: Date | null;

  /**
   * Snapshot of the DB requirement at grinding completion. Null before grinding completes.
   */
  @Column({ type: Number, nullable: true })
  required_blade_count!: number | null;

  @Column({ type: String, nullable: true })
  current_stage_id!: string | null;

  @ManyToOne(() => TrayStageOrmEntity, { nullable: true })
  @JoinColumn({ name: 'current_stage_id' })
  current_stage!: TrayStageOrmEntity | null;

  @Column({ nullable: false, type: Boolean, default: true })
  enabled!: boolean;

  @ManyToOne(() => PartSummaryOrmEntity, { nullable: true })
  @JoinColumn({ name: 'summary_id' })
  summary!: PartSummaryOrmEntity | null;

  @ManyToOne(() => CutterPartTypeOrmEntity, { nullable: true })
  @JoinColumn({ name: 'part_type_id' })
  part_type!: CutterPartTypeOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'createdBy' })
  createdByUser!: UserOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'updatedBy' })
  updatedByUser!: UserOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'deletedBy' })
  deletedByUser!: UserOrmEntity | null;

  public override toJSON(): ITray {
    return instanceToPlain(this) as ITray;
  }
}
