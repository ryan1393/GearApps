import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index } from 'typeorm';

import { AbstractOrmEntity } from '@gearapps/manufacturing/server/util-common';
import { ICutterPullReason } from '@gearapps/manufacturing/shared/util-types';

@Entity({ name: 'cutter_pull_reasons' })
export class CutterPullReasonOrmEntity extends AbstractOrmEntity {
  @Index({ unique: true })
  @Column({ type: String })
  code!: string;

  @Column({ type: String })
  name!: string;

  @Column({ type: String, nullable: true })
  description!: string | null;

  @Column({ type: Boolean, default: true })
  requires_teardown!: boolean;

  @Column({ type: Boolean, default: false })
  returns_to_shelf!: boolean;

  @Column({ type: Number, default: 0 })
  sort_order!: number;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  public override toJSON(): ICutterPullReason {
    return instanceToPlain(this) as ICutterPullReason;
  }
}
