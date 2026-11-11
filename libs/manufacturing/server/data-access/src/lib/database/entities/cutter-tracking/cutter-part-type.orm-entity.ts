import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import { IPartType } from '@meshforge/manufacturing/shared/util-types';

/**
 * Shared part type reference used by Blade Tracking and Cutter Tracking.
 * Values are database rows (initially RING and PINION), not TypeScript enums.
 */
@Entity({ name: 'part_types' })
export class CutterPartTypeOrmEntity extends AbstractOrmEntity {
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

  public override toJSON(): IPartType {
    return instanceToPlain(this) as IPartType;
  }
}
