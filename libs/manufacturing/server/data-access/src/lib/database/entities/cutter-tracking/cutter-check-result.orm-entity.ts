import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import { ICutterCheckResult } from '@meshforge/manufacturing/shared/util-types';

@Entity({ name: 'cutter_check_results' })
export class CutterCheckResultOrmEntity extends AbstractOrmEntity {
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

  public override toJSON(): ICutterCheckResult {
    return instanceToPlain(this) as ICutterCheckResult;
  }
}
