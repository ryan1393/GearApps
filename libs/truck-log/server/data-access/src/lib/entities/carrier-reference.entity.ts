import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'carriers' })
export class CarrierReference {
  @PrimaryGeneratedColumn({ type: 'int' }) id!: number;
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true }) lastUsedAt!: Date | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
