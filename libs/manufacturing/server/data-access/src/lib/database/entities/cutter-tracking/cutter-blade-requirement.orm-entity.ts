import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import { ICutterBladeRequirement } from '@meshforge/manufacturing/shared/util-types';
import { PartSummaryOrmEntity } from '../base/part-summary.orm-entity';
import { CutterPartTypeOrmEntity } from './cutter-part-type.orm-entity';

@Entity({ name: 'cutter_blade_requirements' })
@Index(['summary_id', 'part_type_id'], { unique: true })
export class CutterBladeRequirementOrmEntity extends AbstractOrmEntity {
  @Column({ type: String })
  summary_id!: string;

  @Column({ type: String })
  part_type_id!: string;

  @Column({ type: Number })
  required_blade_count!: number;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  @ManyToOne(() => PartSummaryOrmEntity, { nullable: false })
  @JoinColumn({ name: 'summary_id' })
  summary!: PartSummaryOrmEntity;

  @ManyToOne(() => CutterPartTypeOrmEntity, { nullable: false })
  @JoinColumn({ name: 'part_type_id' })
  part_type!: CutterPartTypeOrmEntity;

  public override toJSON(): ICutterBladeRequirement {
    return instanceToPlain(this) as ICutterBladeRequirement;
  }
}
