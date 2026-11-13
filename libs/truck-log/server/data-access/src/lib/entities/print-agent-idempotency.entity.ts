import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { PrintAgent } from './print-agent.entity';

@Entity({ name: 'print_agent_idempotency' })
@Check('ck_print_agent_idempotency_key', `"idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'`)
@Check('ck_print_agent_idempotency_hash', `"request_sha256" ~ '^[0-9a-f]{64}$'`)
@Check('ck_print_agent_idempotency_status', `"response_status" BETWEEN 200 AND 599`)
@Check('ck_print_agent_idempotency_body', `jsonb_typeof("response_body") = 'object'`)
@Check(
  'ck_print_agent_idempotency_no_claim_token',
  `NOT COALESCE(("response_body" -> 'job') ? 'claimToken', FALSE)`,
)
@Check('ck_print_agent_idempotency_expiry', `"expires_at" > "created_at"`)
@Index('ix_print_agent_idempotency_expiry', { synchronize: false })
export class PrintAgentIdempotency {
  @PrimaryColumn({ name: 'agent_id', type: 'varchar', length: 120 }) agentId!: string;
  @PrimaryColumn({ name: 'idempotency_key', type: 'varchar', length: 128 }) idempotencyKey!: string;
  @Column({ name: 'request_sha256', type: 'varchar', length: 64 }) requestSha256!: string;
  @Column({ name: 'response_status', type: 'int' }) responseStatus!: number;
  @Column({ name: 'response_body', type: 'jsonb' }) responseBody!: Record<string, unknown>;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }) createdAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz', default: () => "NOW() + INTERVAL '7 days'" }) expiresAt!: Date;

  @ManyToOne(() => PrintAgent, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agent_id', foreignKeyConstraintName: 'fk_print_agent_idempotency_agent' })
  agent!: PrintAgent;
}
