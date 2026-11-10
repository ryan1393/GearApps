import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';
import { AbstractOrmEntity } from '@gearapps/manufacturing/server/util-common';
import { ICutterCmmCheck } from '@gearapps/manufacturing/shared/util-types';
import { CutterEventOrmEntity } from './cutter-event.orm-entity';
@Entity({ name: 'cutter_cmm_checks' })
export class CutterCmmCheckOrmEntity extends AbstractOrmEntity {
  @Index({ unique: true }) @Column({ type: String }) event_id!: string;
  @Column({ type: Boolean, nullable: true }) pass_fail!: boolean | null;
  @Column({ type: 'double precision', nullable: true }) flank_1_pa!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_1_sa!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_1_fp!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_1_fp_small!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_1_fu!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_1_frs!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_1_warp!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_1_toe_root!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_1_toe_top!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_1_heel_root!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_1_heel_top!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_2_pa!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_2_sa!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_2_fp!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_2_fp_small!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_2_fu!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_2_frs!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_2_warp!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_2_toe_root!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_2_toe_top!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_2_heel_root!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank_2_heel_top!: number | null;
  @Column({ type: 'double precision', nullable: true }) tooth_thickness!: number | null;
  @Column({ type: 'double precision', nullable: true }) total_fr!: number | null;
  @Column({ type: 'double precision', nullable: true }) sum_error_squared!: number | null;
  @Column({ type: 'double precision', nullable: true }) sum_error_after!: number | null;
  @Column({ type: 'double precision', nullable: true }) result!: number | null;
  @Column({ type: 'text', nullable: true }) comments!: string | null;
  @OneToOne(() => CutterEventOrmEntity, { nullable: false }) @JoinColumn({ name: 'event_id' }) event!: CutterEventOrmEntity;
  public override toJSON(): ICutterCmmCheck { return instanceToPlain(this) as ICutterCmmCheck; }
}
