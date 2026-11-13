import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { TruckLogAccessCredential } from './truck-log-access-credential.entity';

@Entity({ name: 'truck_log_access_idempotency' })
@Check(
  'ck_truck_log_access_idempotency_key',
  `"idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'`,
)
@Check('ck_truck_log_access_idempotency_hash', `"request_sha256" ~ '^[0-9a-f]{64}$'`)
@Check(
  'ck_truck_log_access_idempotency_status',
  `"response_status" BETWEEN 200 AND 599`,
)
@Check(
  'ck_truck_log_access_idempotency_body',
  `jsonb_typeof("response_body") = 'object'`,
)
@Check(
  'ck_truck_log_access_idempotency_expiry',
  `"expires_at" > "created_at"`,
)
@Index('ix_truck_log_access_idempotency_expiry', { synchronize: false })
export class TruckLogAccessIdempotency {
  @PrimaryColumn({ name: 'key_id', type: 'varchar', length: 16 }) keyId!: string;
  @PrimaryColumn({ name: 'idempotency_key', type: 'varchar', length: 128 }) idempotencyKey!: string;
  @Column({ name: 'request_sha256', type: 'varchar', length: 64 }) requestSha256!: string;
  @Column({ name: 'response_status', type: 'int' }) responseStatus!: number;
  @Column({ name: 'response_body', type: 'jsonb' }) responseBody!: Record<string, unknown>;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }) createdAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz', default: () => "NOW() + INTERVAL '7 days'" }) expiresAt!: Date;

  @ManyToOne(() => TruckLogAccessCredential, (credential) => credential.idempotencyRecords, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'key_id',
    foreignKeyConstraintName: 'fk_truck_log_access_idempotency_credential',
  })
  credential!: TruckLogAccessCredential;
}
