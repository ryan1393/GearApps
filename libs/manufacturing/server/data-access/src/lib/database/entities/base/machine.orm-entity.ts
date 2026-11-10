import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@gearapps/manufacturing/server/util-common';
import { IMachine } from '@gearapps/manufacturing/shared/util-types';
import { DepartmentOrmEntity } from './department.orm-entity';

@Entity({ name: 'machines' })
// Created by GearMasterDataBootstrap on existing databases; declared here so
// TypeORM never treats it as drift.
@Index('ix_machines_cutter_builder_eligibility', ['department_id', 'machine_type', 'enabled', 'active'])
export class MachineOrmEntity extends AbstractOrmEntity {
  @Index({ unique: true })
  @Column({ type: String })
  machine_number!: string;

  @Column({ type: String })
  department_id!: string;

  @Column({ type: Number, nullable: true })
  cell!: number | null;

  @Index()
  @Column({ type: Boolean, default: true })
  active!: boolean;

  @Column({ type: String, nullable: true })
  description!: string | null;

  @Index()
  @Column({ type: String, default: 'PRODUCTION' })
  machine_type!: string;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  @ManyToOne(() => DepartmentOrmEntity, { nullable: false })
  @JoinColumn({ name: 'department_id' })
  department!: DepartmentOrmEntity;

  public override toJSON(): IMachine {
    return instanceToPlain(this) as IMachine;
  }
}
