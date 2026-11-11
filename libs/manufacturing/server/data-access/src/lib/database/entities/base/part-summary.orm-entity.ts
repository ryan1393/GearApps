import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import { IPartSummary } from '@meshforge/manufacturing/shared/util-types';
import { ModelOrmEntity } from './model.orm-entity';

@Entity({ name: 'part_summaries' })
@Index(['number', 'revision'], { unique: true })
export class PartSummaryOrmEntity extends AbstractOrmEntity {
  @Column({ type: String })
  number!: string;

  @Column({ type: String, default: '' })
  revision!: string;

  @Column({ type: String, nullable: true })
  model_id!: string | null;

  @Column({ type: String, nullable: true })
  hos!: string | null;

  @Index()
  @Column({ type: Boolean, default: true })
  active!: boolean;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  @ManyToOne(() => ModelOrmEntity, { nullable: true })
  @JoinColumn({ name: 'model_id' })
  model!: ModelOrmEntity | null;

  public override toJSON(): IPartSummary {
    return instanceToPlain(this) as IPartSummary;
  }
}
