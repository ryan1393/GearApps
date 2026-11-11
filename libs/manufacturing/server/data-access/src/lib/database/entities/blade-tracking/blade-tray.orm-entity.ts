import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import {
  IBladeTray,
  IBladeTrayEntity,
} from '@meshforge/manufacturing/shared/util-types';
import { UserOrmEntity } from '../user.orm-entity';
import { TrayOrmEntity } from './tray.orm-entity';
import { BladeOrmEntity } from './blade.orm-entity';
import { BladeTrayDto, BladeTrayDtoOptions } from '../../../dtos/blade-tracking/blade-tray';


@Entity({ name: 'blade_tray' })
@Index('uq_blade_tray_active_blade', ['blade_id'], {
  unique: true,
  where: '"enabled" = true',
})
// @UseDto(BladeDto)
export class BladeTrayOrmEntity
  extends AbstractOrmEntity<BladeTrayDto, BladeTrayDtoOptions>
  implements IBladeTrayEntity {
  @Column({
    nullable: false,
    type: String,
  })
  tray_id!: string;

  @Column({
    nullable: false,
    type: String,
  })
  blade_id!: string;

  @Column({
    nullable: false,
    type: Boolean,
    default: true,
  })
  enabled!: boolean;

  @ManyToOne(() => TrayOrmEntity, {
    nullable: false,
  })
  @JoinColumn({ name: 'tray_id' })
  tray!: TrayOrmEntity;

  @ManyToOne(() => BladeOrmEntity, {
    nullable: false,
  })
  @JoinColumn({ name: 'blade_id' })
  blade!: BladeOrmEntity;

  @ManyToOne(() => UserOrmEntity, {
    nullable: true,
  })
  @JoinColumn({ name: 'createdBy' })
  createdByUser!: UserOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, {
    nullable: true,
  })
  @JoinColumn({ name: 'updatedBy' })
  updatedByUser!: UserOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, {
    nullable: true,
  })
  @JoinColumn({ name: 'deletedBy' })
  deletedByUser!: UserOrmEntity | null;

  public override toJSON(): IBladeTray {
    return instanceToPlain(this) as IBladeTray;
  }
}
