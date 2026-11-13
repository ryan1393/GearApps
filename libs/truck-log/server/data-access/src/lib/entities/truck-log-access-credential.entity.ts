import { Check, Column, Entity, Index, OneToMany, PrimaryColumn } from 'typeorm';
import { TruckLogAccessIdempotency } from './truck-log-access-idempotency.entity';

export const TruckLogAccessScopes = {
  RXO_DOCUMENTS_WRITE: 'rxo-documents:write',
  RXO_DOCUMENTS_REPRINT: 'rxo-documents:reprint',
} as const;

export type TruckLogAccessScope =
  (typeof TruckLogAccessScopes)[keyof typeof TruckLogAccessScopes];

@Entity({ name: 'truck_log_access_credentials' })
@Check('ck_truck_log_access_credentials_key_id', `"key_id" ~ '^[0-9a-f]{16}$'`)
@Check(
  'ck_truck_log_access_credentials_subject_id',
  `"subject_id" ~ '^[A-Za-z0-9][A-Za-z0-9._@-]{0,119}$'`,
)
@Check(
  'ck_truck_log_access_credentials_display_name',
  `NULLIF(BTRIM("display_name"), '') IS NOT NULL`,
)
@Check('ck_truck_log_access_credentials_hash', `"secret_sha256" ~ '^[0-9a-f]{64}$'`)
@Check(
  'ck_truck_log_access_credentials_scopes',
  `jsonb_typeof("scopes") = 'array'
    AND jsonb_array_length("scopes") BETWEEN 1 AND 2
    AND "scopes" <@ '["rxo-documents:write", "rxo-documents:reprint"]'::jsonb`,
)
@Check(
  'ck_truck_log_access_credentials_revocation',
  `("active" = TRUE AND "revoked_at" IS NULL)
    OR ("active" = FALSE AND "revoked_at" IS NOT NULL)`,
)
@Check(
  'ck_truck_log_access_credentials_expiry',
  `"expires_at" IS NULL OR "expires_at" > "created_at"`,
)
@Index('ix_truck_log_access_credentials_subject', { synchronize: false })
@Index('ix_truck_log_access_credentials_expiry', { synchronize: false })
export class TruckLogAccessCredential {
  @PrimaryColumn({ name: 'key_id', type: 'varchar', length: 16 }) keyId!: string;
  @Column({ name: 'subject_id', type: 'varchar', length: 120 }) subjectId!: string;
  @Column({ name: 'display_name', type: 'varchar', length: 160 }) displayName!: string;
  @Column({ name: 'secret_sha256', type: 'varchar', length: 64 }) secretSha256!: string;
  @Column({ type: 'jsonb' }) scopes!: TruckLogAccessScope[];
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }) createdAt!: Date;
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true }) lastUsedAt!: Date | null;
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true }) expiresAt!: Date | null;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;

  @OneToMany(() => TruckLogAccessIdempotency, (record) => record.credential)
  idempotencyRecords!: TruckLogAccessIdempotency[];
}
