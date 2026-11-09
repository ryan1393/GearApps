import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@libs/server/util-common';
import {
  ILocationTray,
  ILocationTrayEntity,
} from '@libs/shared/util-types';
import { UserOrmEntity } from '../user.orm-entity';
import { TrayOrmEntity } from './tray.orm-entity';
import { LocationOrmEntity } from './location.orm-entity';
import { LocationTrayDto, LocationTrayDtoOptions } from '../../../dtos/blade-tracking/location-tray';


@Entity({ name: 'location_tray' })
@Index('uq_location_tray_active_tray', ['tray_id'], {
  unique: true,
  where: '"enabled" = true',
})
// @UseDto(LocationDto)
export class LocationTrayOrmEntity
  extends AbstractOrmEntity<LocationTrayDto, LocationTrayDtoOptions>
  implements ILocationTrayEntity {
  @Column({
    nullable: false,
    type: String,
  })
  tray_id!: string;

  @Column({
    nullable: false,
    type: String,
  })
  location_id!: string;

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

  @ManyToOne(() => LocationOrmEntity, {
    nullable: false,
  })
  @JoinColumn({ name: 'location_id' })
  location!: LocationOrmEntity;

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

  public override toJSON(): ILocationTray {
    return instanceToPlain(this) as ILocationTray;
  }
}
