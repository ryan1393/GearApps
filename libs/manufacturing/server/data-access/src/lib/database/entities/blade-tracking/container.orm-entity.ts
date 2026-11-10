import { instanceToPlain } from 'class-transformer';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@gearapps/manufacturing/server/util-common';
import {
  IContainer,
  IContainerEntity,
} from '@gearapps/manufacturing/shared/util-types';
import { ContainerDto, ContainerDtoOptions } from '../../../dtos/blade-tracking/containers';
import { UserOrmEntity } from '../user.orm-entity';


@Entity({ name: 'containers' })
// @UseDto(ContainerDto)
export class ContainerOrmEntity
  extends AbstractOrmEntity<ContainerDto, ContainerDtoOptions>
  implements IContainerEntity {
  @Column({
    nullable: false,
    type: String,
    unique: true,
  })
  serial_number!: string;

  @Column({
    nullable: false,
    type: Boolean,
    default: true,
  })
  enabled!: boolean;

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

  public override toJSON(): IContainer {
    return instanceToPlain(this) as IContainer;
  }
}
