import { instanceToPlain } from 'class-transformer';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import {
  BladeHistoryEvent,
  BladeStatus,
  IBladeHistory,
  IBladeHistoryEntity,
  Uuid,
} from '@meshforge/manufacturing/shared/util-types';
import { UserOrmEntity } from '../user.orm-entity';
import { BladeOrmEntity } from './blade.orm-entity';

@Entity({ name: 'blade_history' })
export class BladeHistoryOrmEntity
  extends AbstractOrmEntity
  implements IBladeHistoryEntity {
  @Column({ nullable: false, type: String })
  blade_id!: Uuid;

  @Column({ nullable: false, type: String })
  event_type!: BladeHistoryEvent;

  @Column({ nullable: true, type: String })
  from_status?: BladeStatus | null;

  @Column({ nullable: true, type: String })
  to_status?: BladeStatus | null;

  @Column({ nullable: false, type: Number, default: 0 })
  service_cycle!: number;

  @Column({ nullable: true, type: String })
  tray_id?: Uuid | null;

  @Column({ nullable: true, type: String })
  container_id?: Uuid | null;

  @Column({ nullable: true, type: String })
  notes?: string | null;

  @ManyToOne(() => BladeOrmEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'blade_id' })
  blade!: BladeOrmEntity;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'createdBy' })
  createdByUser!: UserOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'updatedBy' })
  updatedByUser!: UserOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'deletedBy' })
  deletedByUser!: UserOrmEntity | null;

  public override toJSON(): IBladeHistory {
    return instanceToPlain(this) as IBladeHistory;
  }
}
