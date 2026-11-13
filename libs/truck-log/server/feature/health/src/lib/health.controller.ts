import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  realpathSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { StationPublic } from '@truck-log/server/auth/station';
import { PLANT_TIME_ZONE_DEFAULT, TRUCK_LOG_VERSION } from '@truck-log/shared/contracts';

const APP_VERSION = TRUCK_LOG_VERSION;
const RELEASE_VERSION = process.env.TRUCK_LOG_RELEASE || TRUCK_LOG_VERSION;

/** The plant zone the web app shows times in: the server's TZ when it is a valid IANA zone. */
function plantTimeZone(): string {
  const configured = (process.env.TZ || '').trim();
  if (!configured) return PLANT_TIME_ZONE_DEFAULT;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configured });
    return configured;
  } catch {
    return PLANT_TIME_ZONE_DEFAULT;
  }
}

const REQUIRED_RELEASE_COLUMNS: Record<string, readonly string[]> = {
  truck_log_access_credentials: [
    'key_id',
    'secret_sha256',
    'scopes',
    'active',
    'expires_at',
    'revoked_at',
  ],
  truck_log_access_idempotency: [
    'key_id',
    'idempotency_key',
    'request_sha256',
    'response_status',
    'response_body',
    'expires_at',
  ],
  truck_visits: [
    'rxo_site_key',
    'rxo_shipment_id',
    'rxo_direction',
    'client_request_id',
    'manual_printing',
  ],
  automatic_print_job_recoveries: ['job_id', 'replacement_package_id', 'request_key', 'reason', 'occurred_at'],
  visit_documents: [
    'original_file_name',
    'rxo_site_key',
    'rxo_shipment_id',
    'rxo_direction',
    'rxo_document_version',
    'rxo_is_active',
    'uploaded_by_key_id',
  ],
  driver_print_packages: [
    'id',
    'truck_visit_id',
    'request_kind',
    'frozen_document_id',
    'request_id',
    'status',
  ],
  driver_print_items: [
    'id',
    'package_id',
    'item_type',
    'visit_document_id',
    'status',
    'assigned_agent_id',
    'lease_token_sha256',
    'lease_expires_at',
  ],
  driver_print_attempts: [
    'id',
    'item_id',
    'attempt_number',
    'attempt_kind',
    'status',
    'idempotency_key',
  ],
  driver_print_events: [
    'id',
    'event_type',
    'actor_type',
    'actor_id',
    'truck_visit_id',
    'visit_document_id',
    'package_id',
    'item_id',
    'details',
  ],
};

const REQUIRED_RELEASE_CONSTRAINTS: Record<
  string,
  { table: string; type: 'c' | 'f' }
> = {
  ck_truck_log_access_credentials_scopes: {
    table: 'truck_log_access_credentials', type: 'c',
  },
  fk_truck_log_access_idempotency_credential: {
    table: 'truck_log_access_idempotency', type: 'f',
  },
  ck_print_agent_idempotency_no_claim_token: {
    table: 'print_agent_idempotency', type: 'c',
  },
  ck_visit_documents_print_agent_capture: {
    table: 'visit_documents', type: 'c',
  },
  ck_visit_documents_validated_packing_slip: {
    table: 'visit_documents', type: 'c',
  },
  ck_truck_visits_rxo_tuple: { table: 'truck_visits', type: 'c' },
  ck_visit_documents_materials_upload: {
    table: 'visit_documents', type: 'c',
  },
  ck_driver_print_packages_reprint_actor: {
    table: 'driver_print_packages', type: 'c',
  },
  ck_driver_print_items_type_status: {
    table: 'driver_print_items', type: 'c',
  },
  ck_driver_print_attempts_state: {
    table: 'driver_print_attempts', type: 'c',
  },
  ck_driver_print_events_type: { table: 'driver_print_events', type: 'c' },
};

const REQUIRED_RELEASE_INDEXES: Record<string, string> = {
  ux_truck_visits_client_request: 'truck_visits',
  ux_visit_documents_rxo_version: 'visit_documents',
  ux_visit_documents_rxo_active: 'visit_documents',
  ux_driver_print_packages_request: 'driver_print_packages',
  ux_driver_print_packages_original_visit: 'driver_print_packages',
  ux_driver_print_items_package_type: 'driver_print_items',
  ux_driver_print_attempts_idempotency: 'driver_print_attempts',
};

const REQUIRED_RELEASE_TRIGGERS: Record<string, string> = {
  trg_truck_visits_rxo_identity: 'truck_visits',
  trg_visit_documents_rxo_association: 'visit_documents',
  trg_visit_documents_rxo_version_chain: 'visit_documents',
  trg_visit_documents_rxo_immutable: 'visit_documents',
  trg_driver_print_packages_validate_document: 'driver_print_packages',
  trg_driver_print_packages_immutable: 'driver_print_packages',
  trg_driver_print_items_validate_document: 'driver_print_items',
  trg_driver_print_items_immutable: 'driver_print_items',
  trg_driver_print_attempts_transition: 'driver_print_attempts',
  trg_driver_print_events_append_only: 'driver_print_events',
};

function assertPhysicalStorageNamespace(
  storageRoot: string,
  namespace: 'sap' | 'rxo',
): string {
  const namespacePath = resolve(storageRoot, namespace);
  mkdirSync(namespacePath, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(namespacePath);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${namespace.toUpperCase()} document storage must be a physical directory.`);
  }
  const expectedPath = resolve(realpathSync(storageRoot), namespace);
  const canonicalPath = realpathSync(namespacePath);
  if (canonicalPath !== expectedPath) {
    throw new Error(`${namespace.toUpperCase()} document storage path is not canonical.`);
  }
  accessSync(canonicalPath, constants.R_OK | constants.W_OK);
  const finalMetadata = lstatSync(namespacePath);
  if (
    finalMetadata.isSymbolicLink()
    || !finalMetadata.isDirectory()
    || realpathSync(namespacePath) !== canonicalPath
  ) {
    throw new Error(`${namespace.toUpperCase()} document storage changed during readiness checks.`);
  }
  return canonicalPath;
}

@StationPublic()
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'alive',
      application: 'Truck Log',
      version: APP_VERSION,
      release: RELEASE_VERSION,
      time: new Date().toISOString(),
      timeZone: plantTimeZone(),
    };
  }

  @Get()
  async health() {
    try {
      const rows = await this.dataSource.query(
        `SELECT to_regclass('public.truck_visits') AS truck_visits,
                to_regclass('public.visit_documents') AS visit_documents,
                to_regclass('public.visit_events') AS visit_events,
                to_regclass('public.sap_document_types') AS sap_document_types,
                to_regclass('public.sap_document_events') AS sap_document_events,
                to_regclass('public.print_agents') AS print_agents,
                to_regclass('public.print_agent_credentials') AS print_agent_credentials,
                to_regclass('public.print_agent_idempotency') AS print_agent_idempotency,
                to_regclass('public.truck_log_access_credentials') AS truck_log_access_credentials,
                to_regclass('public.truck_log_access_idempotency') AS truck_log_access_idempotency,
                to_regclass('public.driver_print_packages') AS driver_print_packages,
                to_regclass('public.driver_print_items') AS driver_print_items,
                to_regclass('public.driver_print_attempts') AS driver_print_attempts,
                to_regclass('public.driver_print_events') AS driver_print_events,
                to_regclass('public.docks') AS docks`,
      );

      const schemaReady = rows[0] && Object.values(rows[0]).every(Boolean);
      if (!schemaReady) {
        throw new Error('Truck Log database schema is incomplete. Run SETUP-TRUCK-LOG.cmd.');
      }

      await this.assertReleaseSchema();

      const claimTokenSecret = this.config
        .get<string>('TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET', '')
        .trim();
      if (!/^[0-9a-fA-F]{64}$/.test(claimTokenSecret)) {
        throw new Error(
          'TRUCK_LOG_PRINT_CLAIM_TOKEN_SECRET must be configured as exactly 64 hexadecimal characters.',
        );
      }

      const storageRoot = resolve(
        this.config.get<string>('TRUCK_LOG_DOCUMENT_STORAGE_ROOT') || './data/documents',
      );
      mkdirSync(storageRoot, { recursive: true });
      accessSync(storageRoot, constants.R_OK | constants.W_OK);
      const sapStorageRoot = resolve(storageRoot, 'sap');
      assertPhysicalStorageNamespace(storageRoot, 'sap');
      accessSync(sapStorageRoot, constants.R_OK | constants.W_OK);
      const rxoStorageRoot = resolve(storageRoot, 'rxo');
      assertPhysicalStorageNamespace(storageRoot, 'rxo');
      accessSync(rxoStorageRoot, constants.R_OK | constants.W_OK);

      return {
        status: 'ok',
        application: 'Truck Log',
        version: APP_VERSION,
        release: RELEASE_VERSION,
        api: 'ready',
        database: 'ready',
        documentStorage: 'ready',
        sapDocumentStorage: 'ready',
        rxoDocumentStorage: 'ready',
        printAgentApi: 'ready',
        packingSlipIngestion: 'ready',
        accessCredentials: 'ready',
        rxoDriverDocuments: 'ready',
        driverPrintPackages: 'ready',
        time: new Date().toISOString(),
        timeZone: plantTimeZone(),
      };
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : 'Truck Log database or document storage is not ready.';
      throw new ServiceUnavailableException(message);
    }
  }

  private async assertReleaseSchema(): Promise<void> {
    const requiredTables = Object.keys(REQUIRED_RELEASE_COLUMNS);
    const columnRows = await this.dataSource.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [requiredTables],
    );
    const columnsByTable = new Map<string, Set<string>>();
    for (const row of columnRows as Array<{ table_name: string; column_name: string }>) {
      const columns = columnsByTable.get(row.table_name) ?? new Set<string>();
      columns.add(row.column_name);
      columnsByTable.set(row.table_name, columns);
    }
    for (const [table, requiredColumns] of Object.entries(REQUIRED_RELEASE_COLUMNS)) {
      const actualColumns = columnsByTable.get(table) ?? new Set<string>();
      if (requiredColumns.some((column) => !actualColumns.has(column))) {
        throw new Error('Truck Log database schema is incomplete. Run the Truck Log database migrations.');
      }
    }

    const constraintRows = await this.dataSource.query(
      `SELECT constraint_row.conname,
              relation_row.relname AS table_name,
              constraint_row.contype
         FROM pg_catalog.pg_constraint constraint_row
         JOIN pg_catalog.pg_class relation_row
           ON relation_row.oid = constraint_row.conrelid
         JOIN pg_catalog.pg_namespace namespace_row
           ON namespace_row.oid = relation_row.relnamespace
        WHERE namespace_row.nspname = 'public'
          AND constraint_row.conname = ANY($1::text[])
          AND constraint_row.convalidated = TRUE`,
      [Object.keys(REQUIRED_RELEASE_CONSTRAINTS)],
    );
    const constraints = new Set(
      (constraintRows as Array<{
        conname: string;
        table_name: string;
        contype: string;
      }>).map((row) => `${row.table_name}:${row.conname}:${row.contype}`),
    );
    if (Object.entries(REQUIRED_RELEASE_CONSTRAINTS).some(
      ([name, expected]) => !constraints.has(`${expected.table}:${name}:${expected.type}`),
    )) {
      throw new Error('Truck Log database constraints are incomplete. Run the Truck Log database migrations.');
    }

    const indexRows = await this.dataSource.query(
      `SELECT index_relation.relname AS indexname,
              table_relation.relname AS table_name
         FROM pg_catalog.pg_index index_row
         JOIN pg_catalog.pg_class index_relation
           ON index_relation.oid = index_row.indexrelid
         JOIN pg_catalog.pg_class table_relation
           ON table_relation.oid = index_row.indrelid
         JOIN pg_catalog.pg_namespace namespace_row
           ON namespace_row.oid = table_relation.relnamespace
        WHERE namespace_row.nspname = 'public'
          AND index_relation.relname = ANY($1::text[])
          AND index_row.indisvalid = TRUE
          AND index_row.indisready = TRUE
          AND index_row.indisunique = TRUE`,
      [Object.keys(REQUIRED_RELEASE_INDEXES)],
    );
    const indexes = new Set(
      (indexRows as Array<{ indexname: string; table_name: string }>).map(
        (row) => `${row.table_name}:${row.indexname}`,
      ),
    );
    if (Object.entries(REQUIRED_RELEASE_INDEXES).some(
      ([name, table]) => !indexes.has(`${table}:${name}`),
    )) {
      throw new Error('Truck Log database indexes are incomplete. Run the Truck Log database migrations.');
    }

    const triggerRows = await this.dataSource.query(
      `SELECT trigger_row.tgname AS trigger_name,
              relation_row.relname AS table_name
         FROM pg_catalog.pg_trigger trigger_row
         JOIN pg_catalog.pg_class relation_row
           ON relation_row.oid = trigger_row.tgrelid
         JOIN pg_catalog.pg_namespace namespace_row
           ON namespace_row.oid = relation_row.relnamespace
        WHERE namespace_row.nspname = 'public'
          AND trigger_row.tgname = ANY($1::text[])
          AND trigger_row.tgisinternal = FALSE
          AND trigger_row.tgenabled <> 'D'`,
      [Object.keys(REQUIRED_RELEASE_TRIGGERS)],
    );
    const triggers = new Set(
      (triggerRows as Array<{ trigger_name: string; table_name: string }>).map(
        (row) => `${row.table_name}:${row.trigger_name}`,
      ),
    );
    if (Object.entries(REQUIRED_RELEASE_TRIGGERS).some(
      ([name, table]) => !triggers.has(`${table}:${name}`),
    )) {
      throw new Error('Truck Log database triggers are incomplete. Run the Truck Log database migrations.');
    }
  }
}
