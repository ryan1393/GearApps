import { instanceToPlain } from 'class-transformer';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { AbstractOrmEntity } from '@gearapps/manufacturing/server/util-common';
import { ICutterMachineRun } from '@gearapps/manufacturing/shared/util-types';
import { UserOrmEntity } from '../user.orm-entity';
import { MachineOrmEntity } from '../base/machine.orm-entity';
import { PartOrmEntity } from '../base/part.orm-entity';
import { CutterBuildOrmEntity } from './cutter-build.orm-entity';

@Entity({ name: 'cutter_machine_runs' })
@Index('uq_cutter_machine_runs_active_build', ['cutter_build_id'], {
  unique: true,
  where: '"enabled" = true',
})
@Index('uq_cutter_machine_runs_active_machine', ['machine_id'], {
  unique: true,
  where: '"enabled" = true',
})
@Check('"current_piece_count" >= 0')
@Check('"last_check_piece_count" >= 0')
export class CutterMachineRunOrmEntity extends AbstractOrmEntity {
  @Column({ type: String })
  cutter_build_id!: string;

  @Column({ type: String })
  machine_id!: string;

  @Column({ type: String })
  part_id!: string;

  @Column({ type: String })
  machine_number!: string;

  @Column({ type: String, nullable: true })
  shift!: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  installed_at!: Date;

  @Column({ type: 'timestamp', nullable: true })
  removed_at!: Date | null;

  @Column({ type: Number, default: 0 })
  current_piece_count!: number;

  @Column({ type: Number, default: 0 })
  last_check_piece_count!: number;

  @Column({ type: String, nullable: true })
  installed_by_user_id!: string | null;

  @Column({ type: String, nullable: true })
  removed_by_user_id!: string | null;

  @Column({ type: Boolean, default: true })
  enabled!: boolean;

  @ManyToOne(() => CutterBuildOrmEntity, { nullable: false })
  @JoinColumn({ name: 'cutter_build_id' })
  cutter_build!: CutterBuildOrmEntity;

  @ManyToOne(() => MachineOrmEntity, { nullable: false })
  @JoinColumn({ name: 'machine_id' })
  machine!: MachineOrmEntity;

  @ManyToOne(() => PartOrmEntity, { nullable: false })
  @JoinColumn({ name: 'part_id' })
  part!: PartOrmEntity;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'installed_by_user_id' })
  installed_by_user!: UserOrmEntity | null;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'removed_by_user_id' })
  removed_by_user!: UserOrmEntity | null;

  public override toJSON(): ICutterMachineRun {
    return instanceToPlain(this) as ICutterMachineRun;
  }
}
