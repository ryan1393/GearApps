import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index } from 'typeorm';

import { AbstractOrmEntity } from '@libs/server/util-common';
import { ITrayStage } from '@libs/shared/util-types';

@Entity({ name: 'tray_stages' })
export class TrayStageOrmEntity extends AbstractOrmEntity {
  @Index({ unique: true })
  @Column({ type: String })
  code!: string;

  @Column({ type: String })
  name!: string;

  @Column({ type: String, nullable: true })
  description!: string | null;

  @Column({ type: Number, default: 0 })
  sort_order!: number;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  public override toJSON(): ITrayStage {
    return instanceToPlain(this) as ITrayStage;
  }
}
