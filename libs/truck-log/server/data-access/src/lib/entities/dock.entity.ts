import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'docks' })
export class Dock {
  @PrimaryGeneratedColumn({ type: 'int' }) id!: number;
  @Column({ type: 'varchar', length: 50, unique: true }) code!: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) description!: string | null;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ name: 'sort_order', type: 'int', default: 0 }) sortOrder!: number;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
