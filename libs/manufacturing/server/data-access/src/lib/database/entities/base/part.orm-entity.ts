import { instanceToPlain } from 'class-transformer';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
} from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import { IPart } from '@meshforge/manufacturing/shared/util-types';
import { PartSummaryOrmEntity } from './part-summary.orm-entity';
import { CutterPartTypeOrmEntity } from '../cutter-tracking/cutter-part-type.orm-entity';
import { RollMasterOrmEntity } from './roll-master.orm-entity';

@Entity({ name: 'parts' })
@Index(['summary_id', 'part_type_id'])
export class PartOrmEntity extends AbstractOrmEntity {
  @Index({ unique: true })
  @Column({ type: String })
  part_number!: string;

  @Column({ type: String })
  summary_id!: string;

  @Column({ type: String })
  part_type_id!: string;

  @Column({ type: Number, nullable: true })
  teeth!: number | null;

  @Index()
  @Column({ type: Boolean, default: true })
  active!: boolean;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  @ManyToOne(() => PartSummaryOrmEntity, { nullable: false })
  @JoinColumn({ name: 'summary_id' })
  summary!: PartSummaryOrmEntity;

  @ManyToOne(() => CutterPartTypeOrmEntity, { nullable: false })
  @JoinColumn({ name: 'part_type_id' })
  part_type!: CutterPartTypeOrmEntity;

  @OneToOne(() => RollMasterOrmEntity, (rollMaster) => rollMaster.part)
  roll_master!: RollMasterOrmEntity | null;

  public override toJSON(): IPart {
    return instanceToPlain(this) as IPart;
  }
}
