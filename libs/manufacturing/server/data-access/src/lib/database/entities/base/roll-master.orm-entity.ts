import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import { IRollMaster } from '@meshforge/manufacturing/shared/util-types';
import { PartOrmEntity } from './part.orm-entity';

@Entity({ name: 'roll_masters' })
export class RollMasterOrmEntity extends AbstractOrmEntity {
  @Index({ unique: true })
  @Column({ type: String })
  part_id!: string;

  /** Legacy minimum field retained for older clients/base-data tools. */
  @Column({ type: Number, default: 0 })
  required_count!: number;

  @Column({ type: Number, default: 0 })
  current_quantity!: number;

  @Column({ type: Number, default: 0 })
  minimum_quantity!: number;

  @Index()
  @Column({ type: Boolean, default: true })
  active!: boolean;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  @Column({ type: String, nullable: true })
  notes!: string | null;

  @OneToOne(() => PartOrmEntity, (part) => part.roll_master, {
    nullable: false,
  })
  @JoinColumn({ name: 'part_id' })
  part!: PartOrmEntity;

  public override toJSON(): IRollMaster {
    return instanceToPlain(this) as IRollMaster;
  }
}
