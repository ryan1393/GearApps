import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'locations' })
export class LocationReference {
  @PrimaryGeneratedColumn({ type: 'int' }) id!: number;
  @Column({ type: 'varchar', length: 250 }) name!: string;
  @Column({ name: 'address_line1', type: 'varchar', length: 250, nullable: true }) addressLine1!: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) city!: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) state!: string | null;
  @Column({ name: 'postal_code', type: 'varchar', length: 30, nullable: true }) postalCode!: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) country!: string | null;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true }) lastUsedAt!: Date | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
