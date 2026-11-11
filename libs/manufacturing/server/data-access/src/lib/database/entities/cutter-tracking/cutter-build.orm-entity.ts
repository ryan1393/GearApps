import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AbstractOrmEntity } from '@meshforge/manufacturing/server/util-common';
import { ICutterBuild } from '@meshforge/manufacturing/shared/util-types';
import { PartSummaryOrmEntity } from '../base/part-summary.orm-entity';
import { UserOrmEntity } from '../user.orm-entity';
import { CutterBodyOrmEntity } from './cutter-body.orm-entity';
import { CutterBuildStatusOrmEntity } from './cutter-build-status.orm-entity';
import { CutterPartTypeOrmEntity } from './cutter-part-type.orm-entity';
import { MachineOrmEntity } from '../base/machine.orm-entity';
@Entity({ name: 'cutter_builds' })
@Index('ix_cutter_builds_builder_machine', ['cutter_builder_machine_id'])
@Index(['cutter_body_id', 'build_increment'], { unique: true })
@Index('uq_cutter_builds_open_body', ['cutter_body_id'], {
  unique: true,
  where: '"completed_at" IS NULL',
})
export class CutterBuildOrmEntity extends AbstractOrmEntity {
  @Index({ unique: true }) @Column({ type: String }) build_number!: string;
  @Column({ type: Number }) build_increment!: number;
  @Column({ type: String }) cutter_body_id!: string;
  @Column({ type: String }) summary_id!: string;
  @Column({ type: String }) part_type_id!: string;
  @Column({ type: String }) status_id!: string;
  @Column({ type: Boolean, default: false }) honed!: boolean;
  @Column({ type: Boolean, default: false }) coated!: boolean;
  @Column({ type: 'double precision', nullable: true }) ib_ro!: number | null;
  @Column({ type: 'double precision', nullable: true }) ob_ro!: number | null;
  @Column({ type: 'text', nullable: true }) comments!: string | null;
  @Column({ type: String, nullable: true }) built_by_user_id!: string | null;
  @Column({ type: String, nullable: true }) cutter_builder_machine_id!: string | null;
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }) built_at!: Date;
  @Column({ type: 'timestamp', nullable: true }) completed_at!: Date | null;
  @ManyToOne(() => CutterBodyOrmEntity, { nullable: false }) @JoinColumn({ name: 'cutter_body_id' }) cutter_body!: CutterBodyOrmEntity;
  @ManyToOne(() => PartSummaryOrmEntity, { nullable: false }) @JoinColumn({ name: 'summary_id' }) summary!: PartSummaryOrmEntity;
  @ManyToOne(() => CutterPartTypeOrmEntity, { nullable: false }) @JoinColumn({ name: 'part_type_id' }) part_type!: CutterPartTypeOrmEntity;
  @ManyToOne(() => CutterBuildStatusOrmEntity, { nullable: false }) @JoinColumn({ name: 'status_id' }) status!: CutterBuildStatusOrmEntity;
  @ManyToOne(() => UserOrmEntity, { nullable: true }) @JoinColumn({ name: 'built_by_user_id' }) built_by_user!: UserOrmEntity | null;
  @ManyToOne(() => MachineOrmEntity, { nullable: true }) @JoinColumn({ name: 'cutter_builder_machine_id' }) cutter_builder_machine!: MachineOrmEntity | null;
  public override toJSON(): ICutterBuild { return instanceToPlain(this) as ICutterBuild; }
}
