import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import {
  IContainerTray,
  IContainerTrayEntity,
} from '@meshforge/manufacturing/shared/util-types';
import { UserOrmEntity } from '../user.orm-entity';
import { TrayOrmEntity } from './tray.orm-entity';
import { ContainerOrmEntity } from './container.orm-entity';
import { ContainerTrayDto, ContainerTrayDtoOptions } from '../../../dtos/blade-tracking/container-tray';


@Entity({ name: 'container_tray' })
@Index('uq_container_tray_active_tray', ['tray_id'], {
  unique: true,
  where: '"enabled" = true',
})
// @UseDto(ContainerDto)
export class ContainerTrayOrmEntity
  extends AbstractOrmEntity<ContainerTrayDto, ContainerTrayDtoOptions>
  implements IContainerTrayEntity {
  @Column({
    nullable: false,
    type: String,
  })
  tray_id!: string;

  @Column({
    nullable: false,
    type: String,
  })
  container_id!: string;

  @Column({
    nullable: false,
    type: Boolean,
    default: true,
  })
  enabled!: boolean;

  @Column({ type: 'uuid', nullable: true })
  packed_from_location_id!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  packed_at!: Date | null;

  @ManyToOne(() => TrayOrmEntity, {
    nullable: false,
  })
  @JoinColumn({ name: 'tray_id' })
  tray!: TrayOrmEntity;

  @ManyToOne(() => ContainerOrmEntity, {
    nullable: false,
  })
  @JoinColumn({ name: 'container_id' })
  container!: ContainerOrmEntity;

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

  public override toJSON(): IContainerTray {
    return instanceToPlain(this) as IContainerTray;
  }
}
