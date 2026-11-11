import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import { BladeStatus, IBlade, IBladeEntity } from '@meshforge/manufacturing/shared/util-types';
import { BladeDto, BladeDtoOptions } from '../../../dtos/blade-tracking/blades/blade.dto';
import { PartSummaryOrmEntity } from '../base/part-summary.orm-entity';
import { CutterPartTypeOrmEntity } from '../cutter-tracking/cutter-part-type.orm-entity';
import { UserOrmEntity } from '../user.orm-entity';

@Entity({ name: 'blades' })
export class BladeOrmEntity
  extends AbstractOrmEntity<BladeDto, BladeDtoOptions>
  implements IBladeEntity {
  @Column({ nullable: false, type: String })
  summary_id!: string;

  @Index({ unique: true })
  @Column({ nullable: false, type: String })
  serial_number!: string;

  @Column({ nullable: false, type: String })
  part_type_id!: string;

  @Column({ nullable: false, type: String, default: BladeStatus.NEW })
  status!: BladeStatus;

  @Column({ nullable: false, type: Number, default: 0 })
  service_cycle!: number;

  @Column({ nullable: false, type: Boolean, default: true })
  enabled!: boolean;

  @ManyToOne(() => PartSummaryOrmEntity, { nullable: false })
  @JoinColumn({ name: 'summary_id' })
  summary!: PartSummaryOrmEntity;

  @ManyToOne(() => CutterPartTypeOrmEntity, { nullable: false })
  @JoinColumn({ name: 'part_type_id' })
  part_type!: CutterPartTypeOrmEntity;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'createdBy' })
  createdByUser!: UserOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'updatedBy' })
  updatedByUser!: UserOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'deletedBy' })
  deletedByUser!: UserOrmEntity | null;

  public override toJSON(): IBlade {
    return instanceToPlain(this) as IBlade;
  }
}
