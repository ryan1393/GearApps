import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'scheduled_loads' })
export class ScheduledLoad {
  @PrimaryGeneratedColumn({ type: 'int' }) id!: number;
  @Column({ name: 'load_number', type: 'varchar', length: 120 }) loadNumber!: string;
  @Column({ name: 'scheduled_at', type: 'timestamptz' }) scheduledAt!: Date;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ type: 'varchar', length: 120, nullable: true }) source!: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
