import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { PrintAgent } from './print-agent.entity';

@Entity({ name: 'print_agent_credentials' })
@Check('ck_print_agent_credentials_key_id', `"key_id" ~ '^[0-9a-f]{16}$'`)
@Check('ck_print_agent_credentials_hash', `"secret_sha256" ~ '^[0-9a-f]{64}$'`)
@Check('ck_print_agent_credentials_scopes', `jsonb_typeof("scopes") = 'array'`)
@Check('ck_print_agent_credentials_revocation', `("active" = TRUE AND "revoked_at" IS NULL) OR "active" = FALSE`)
@Index('ix_print_agent_credentials_agent', { synchronize: false })
export class PrintAgentCredential {
  @PrimaryColumn({ name: 'key_id', type: 'varchar', length: 16 }) keyId!: string;
  @Column({ name: 'agent_id', type: 'varchar', length: 120 }) agentId!: string;
  @Column({ name: 'secret_sha256', type: 'varchar', length: 64 }) secretSha256!: string;
  @Column({ type: 'jsonb', default: () => `'["heartbeat"]'::jsonb` }) scopes!: string[];
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }) createdAt!: Date;
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true }) lastUsedAt!: Date | null;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;

  @ManyToOne(() => PrintAgent, (agent) => agent.credentials, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agent_id', foreignKeyConstraintName: 'fk_print_agent_credentials_agent' })
  agent!: PrintAgent;
}

