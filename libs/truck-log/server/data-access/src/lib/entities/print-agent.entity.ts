import { Check, Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { PrintAgentCredential } from './print-agent-credential.entity';

export interface PrintAgentRouteConfiguration {
  route: string;
  sourceQueue: string;
  outputPrinter: string;
}

@Entity({ name: 'print_agents' })
@Check('ck_print_agents_id', `"agent_id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$'`)
@Check('ck_print_agents_name', `NULLIF(BTRIM("display_name"), '') IS NOT NULL`)
@Check('ck_print_agents_routes', `jsonb_typeof("configured_routes") = 'array'`)
@Check('ck_print_agents_error_pair', `"last_error" IS NULL OR "last_error_at" IS NOT NULL`)
export class PrintAgent {
  @PrimaryColumn({ name: 'agent_id', type: 'varchar', length: 120 }) agentId!: string;
  @Column({ name: 'display_name', type: 'varchar', length: 160 }) displayName!: string;
  @Column({ type: 'boolean', default: true }) enabled!: boolean;
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true }) lastSeenAt!: Date | null;
  @Column({ name: 'agent_version', type: 'varchar', length: 80, nullable: true }) agentVersion!: string | null;
  @Column({ name: 'configured_routes', type: 'jsonb', default: () => "'[]'::jsonb" }) configuredRoutes!: PrintAgentRouteConfiguration[];
  @Column({ name: 'last_successful_capture_at', type: 'timestamptz', nullable: true }) lastSuccessfulCaptureAt!: Date | null;
  @Column({ name: 'last_successful_print_at', type: 'timestamptz', nullable: true }) lastSuccessfulPrintAt!: Date | null;
  @Column({ name: 'last_error_at', type: 'timestamptz', nullable: true }) lastErrorAt!: Date | null;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError!: string | null;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' }) updatedAt!: Date;

  @OneToMany(() => PrintAgentCredential, (credential) => credential.agent)
  credentials!: PrintAgentCredential[];
}

