import { instanceToPlain } from 'class-transformer';
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';

import { AbstractOrmEntity } from '@libs/server/util-common';
import { ICutterTeardown } from '@libs/shared/util-types';
import { TrayOrmEntity } from '../blade-tracking/tray.orm-entity';
import { UserOrmEntity } from '../user.orm-entity';
import { CutterBuildOrmEntity } from './cutter-build.orm-entity';

@Entity({ name: 'cutter_teardowns' })
@Check('"original_blade_count" >= 0')
@Check('"returned_blade_count" >= 0')
@Check('"scrapped_blade_count" >= 0')
@Check('"returned_blade_count" + "scrapped_blade_count" = "original_blade_count"')
export class CutterTeardownOrmEntity extends AbstractOrmEntity {
  @Index({ unique: true })
  @Column({ type: String })
  cutter_build_id!: string;

  @Column({ type: String })
  tray_id!: string;

  @Column({ type: Number })
  original_blade_count!: number;

  @Column({ type: Number })
  returned_blade_count!: number;

  @Column({ type: Number })
  scrapped_blade_count!: number;

  @Column({ type: String, nullable: true })
  torn_down_by_user_id!: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  torn_down_at!: Date;

  @Column({ type: 'text', nullable: true })
  comments!: string | null;

  @OneToOne(() => CutterBuildOrmEntity, { nullable: false })
  @JoinColumn({ name: 'cutter_build_id' })
  cutter_build!: CutterBuildOrmEntity;

  @ManyToOne(() => TrayOrmEntity, { nullable: false })
  @JoinColumn({ name: 'tray_id' })
  tray!: TrayOrmEntity;

  @ManyToOne(() => UserOrmEntity, { nullable: true })
  @JoinColumn({ name: 'torn_down_by_user_id' })
  torn_down_by_user!: UserOrmEntity | null;

  public override toJSON(): ICutterTeardown {
    return instanceToPlain(this) as ICutterTeardown;
  }
}
