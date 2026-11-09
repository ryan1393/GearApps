import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AbstractOrmEntity } from '@libs/server/util-common';
import { ICutterEvent } from '@libs/shared/util-types';
import { UserOrmEntity } from '../user.orm-entity';
import { CutterBuildOrmEntity } from './cutter-build.orm-entity';
import { CutterEventTypeOrmEntity } from './cutter-event-type.orm-entity';
import { CutterCheckResultOrmEntity } from './cutter-check-result.orm-entity';
import { CutterPullReasonOrmEntity } from './cutter-pull-reason.orm-entity';
@Entity({ name: 'cutter_events' })
@Index(['cutter_build_id', 'occurred_at'])
export class CutterEventOrmEntity extends AbstractOrmEntity {
  @Column({ type: String }) cutter_build_id!: string;
  @Column({ type: String }) event_type_id!: string;
  @Column({ type: Number, default: 0 }) piece_count!: number;
  @Column({ type: String, nullable: true }) machine_number!: string | null;
  @Column({ type: String, nullable: true }) part_number!: string | null;
  @Column({ type: String, nullable: true }) user_id!: string | null;
  @Column({ type: String, nullable: true }) check_result_id!: string | null;
  @Column({ type: String, nullable: true }) pull_reason_id!: string | null;
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' }) occurred_at!: Date;
  @Column({ type: 'text', nullable: true }) comments!: string | null;
@ManyToOne(() => CutterBuildOrmEntity, { nullable: false }) @JoinColumn({ name: 'cutter_build_id' }) cutter_build!: CutterBuildOrmEntity;
  @ManyToOne(() => CutterEventTypeOrmEntity, { nullable: false }) @JoinColumn({ name: 'event_type_id' }) event_type!: CutterEventTypeOrmEntity;
  @ManyToOne(() => UserOrmEntity, { nullable: true }) @JoinColumn({ name: 'user_id' }) user!: UserOrmEntity | null;
  @ManyToOne(() => CutterCheckResultOrmEntity, { nullable: true }) @JoinColumn({ name: 'check_result_id' }) check_result!: CutterCheckResultOrmEntity | null;
  @ManyToOne(() => CutterPullReasonOrmEntity, { nullable: true }) @JoinColumn({ name: 'pull_reason_id' }) pull_reason!: CutterPullReasonOrmEntity | null;
  public override toJSON(): ICutterEvent { return instanceToPlain(this) as ICutterEvent; }
}
