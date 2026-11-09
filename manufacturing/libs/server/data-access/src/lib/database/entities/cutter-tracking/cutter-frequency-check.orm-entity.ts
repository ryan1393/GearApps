import { instanceToPlain } from 'class-transformer';
import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';
import { AbstractOrmEntity } from '@libs/server/util-common';
import { ICutterFrequencyCheck } from '@libs/shared/util-types';
import { CutterEventOrmEntity } from './cutter-event.orm-entity';
@Entity({ name: 'cutter_frequency_checks' })
export class CutterFrequencyCheckOrmEntity extends AbstractOrmEntity {
  @Index({ unique: true }) @Column({ type: String }) event_id!: string;
  @Column({ type: Boolean, nullable: true }) pass_fail!: boolean | null;
  @Column({ type: 'double precision', nullable: true }) s_e_square!: number | null;
  @Column({ type: 'double precision', nullable: true }) s_e_after!: number | null;
  @Column({ type: 'double precision', nullable: true }) s_e_result!: number | null;
  @Column({ type: 'double precision', nullable: true }) total_fr!: number | null;
  @Column({ type: 'double precision', nullable: true }) tooth_thickness!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank1_pa!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank1_sa!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank2_pa!: number | null;
  @Column({ type: 'double precision', nullable: true }) flank2_sa!: number | null;
  @Column({ type: 'double precision', nullable: true }) size_check!: number | null;
  @Column({ type: 'text', nullable: true }) comments!: string | null;
  @OneToOne(() => CutterEventOrmEntity, { nullable: false }) @JoinColumn({ name: 'event_id' }) event!: CutterEventOrmEntity;
  public override toJSON(): ICutterFrequencyCheck { return instanceToPlain(this) as ICutterFrequencyCheck; }
}
