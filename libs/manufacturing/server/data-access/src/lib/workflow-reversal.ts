import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { dsfCutterCountsEnabled } from '@meshforge/manufacturing/server/util-common';
import { STARTUP_SCHEMA_LOCK_SQL } from '@meshforge/manufacturing/shared/util-constants';
import { CONTAINER_SET_SCHEMA } from './coater-container-set';
import { reverseCutterRequestAllocation } from './cutter-request-allocation';

export type ReversalApp = 'GREENSHED' | 'CUTTER_BUILDER' | 'BLADE_TRACKING';
// Columns this module reads by name. Declared so strict index-signature checks
// pass; any other column is still carried through untouched via the index signature.
type KnownColumn =
  | 'enabled' | 'deletedAt' | 'updatedAt' | 'updatedBy'
  | 'tray_id' | 'blade_id' | 'cutter_build_id' | 'location_id' | 'container_id'
  | 'packed_at' | 'packed_from_location_id' | 'container_set_id'
  | 'current_piece_count' | 'last_check_piece_count';
type Row = { id: string } & { [K in KnownColumn]?: unknown } & Record<string, unknown>;
type SnapshotTable =
  | 'trays' | 'blades' | 'blade_tray' | 'location_tray' | 'container_tray' | 'container_sets' | 'container_set_blades'
  | 'tray_grinding_runs' | 'blade_history' | 'locations' | 'containers' | 'cutter_bodies'
  | 'cutter_builds' | 'cutter_build_blades' | 'cutter_build_trays' | 'cutter_events'
  | 'cutter_machine_runs' | 'cutter_build_locations' | 'cutter_teardowns'
  | 'cutter_frequency_checks' | 'cutter_cmm_checks';
type Snapshot = { [K in SnapshotTable]?: Row[] } & Record<string, Row[]>;
export interface ReversalScope {
  app: ReversalApp;
  trayIds?: string[];
  bladeIds?: string[];
  /** Containers whose blade set the operation packs or receives. */
  containerIds?: string[];
  bodyIds?: string[];
  buildIds?: string[];
}
interface JournalRow {
  id: string; app: ReversalApp; identifier: string; action: string;
  scope: ReversalScope; before_state: Snapshot; after_state: Snapshot;
  created_at: string; created_by: string; canceled_at: string | null;
  canceled_by: string | null; reason: string | null;
}
interface JournalChange { table_name: string; row_id: string; before_row: Row | null; after_row: Row | null; }

// Only these application tables can be restored. SQL identifiers never come from clients.
const INVENTORY_TABLES = ['trays', 'blades', 'blade_tray', 'location_tray', 'container_tray', 'container_sets', 'container_set_blades', 'tray_grinding_runs', 'blade_history'];
const CUTTER_TABLES = ['cutter_builds', 'cutter_build_blades', 'cutter_build_trays', 'cutter_events', 'cutter_machine_runs', 'cutter_build_locations', 'cutter_teardowns', 'cutter_frequency_checks', 'cutter_cmm_checks'];
const TABLES = [...INVENTORY_TABLES, ...CUTTER_TABLES];
const READ_ONLY_TABLES = ['locations', 'containers', 'cutter_bodies'];
const keys = (values: unknown[]) => [...new Set(values.filter((v): v is string => typeof v === 'string' && !!v))].sort();
const quote = (name: string) => '"' + name.replace(/"/g, '""') + '"';

export const WORKFLOW_JOURNAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS public.dana_workflow_journal_v1 (
    id uuid PRIMARY KEY, app text NOT NULL, identifier text NOT NULL, action text NOT NULL,
    scope jsonb NOT NULL, before_state jsonb NOT NULL, after_state jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_by text NOT NULL,
    canceled_at timestamptz, canceled_by text, reason text,
    CHECK (app IN ('GREENSHED', 'CUTTER_BUILDER', 'BLADE_TRACKING'))
  );
  CREATE INDEX IF NOT EXISTS dana_workflow_journal_lookup_v1
    ON public.dana_workflow_journal_v1 (app, identifier, created_at DESC);
  CREATE TABLE IF NOT EXISTS public.dana_workflow_changes_v1 (
    operation_id uuid NOT NULL, table_name text NOT NULL, row_id text NOT NULL,
    before_row jsonb, after_row jsonb, PRIMARY KEY (operation_id, table_name, row_id)
  );
  CREATE OR REPLACE FUNCTION public.dana_capture_workflow_change_v1()
  RETURNS trigger LANGUAGE plpgsql AS $workflow_capture$
  DECLARE operation text := current_setting('dana.workflow_operation', true);
  BEGIN
    IF operation IS NULL OR operation = '' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
    INSERT INTO public.dana_workflow_changes_v1
      (operation_id, table_name, row_id, before_row, after_row)
    VALUES (operation::uuid, TG_TABLE_NAME,
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END)
    ON CONFLICT (operation_id, table_name, row_id) DO UPDATE SET after_row = EXCLUDED.after_row;
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END
  $workflow_capture$;
`;

export const WORKFLOW_CAPTURE_TRIGGERS = TABLES.map(table =>
  `CREATE OR REPLACE TRIGGER dana_workflow_capture_v1 AFTER INSERT OR UPDATE OR DELETE ON public.${quote(table)} FOR EACH ROW EXECUTE FUNCTION public.dana_capture_workflow_change_v1()`,
);

@Injectable()
export class WorkflowJournalBootstrap implements OnModuleInit {
  constructor(@InjectDataSource() private readonly source: DataSource) {}
  async onModuleInit(): Promise<void> {
    await this.source.transaction(async manager => {
      await manager.query(STARTUP_SCHEMA_LOCK_SQL);
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('dana-workflow-journal-v1'))");
      await manager.query(WORKFLOW_JOURNAL_SCHEMA);
      // Capture triggers need every journaled table, whichever bootstrap runs first.
      await manager.query(CONTAINER_SET_SCHEMA);
      for (const sql of WORKFLOW_CAPTURE_TRIGGERS) await manager.query(sql);
    });
  }
}

async function rows(manager: EntityManager, table: string, conditions: Array<[string, string[]]>): Promise<Row[]> {
  if (![...TABLES, ...READ_ONLY_TABLES].includes(table)) throw new Error('Unsupported workflow table');
  const active = conditions.filter(([, ids]) => ids.length);
  if (!active.length) return [];
  const result: Array<{ row: Row }> = await manager.query(
    'SELECT to_jsonb(t) AS row FROM public.' + quote(table) + ' t WHERE ' +
    active.map(([column], i) => quote(column) + '::text = ANY($' + (i + 1) + '::text[])').join(' OR ') + ' ORDER BY id',
    active.map(([, ids]) => ids),
  );
  return result.map(x => x.row);
}

async function snapshot(manager: EntityManager, scope: ReversalScope): Promise<Snapshot> {
  const state: Snapshot = {};
  let trayIds = keys(scope.trayIds ?? []);
  const bodyIds = keys(scope.bodyIds ?? []);
  let buildIds = keys(scope.buildIds ?? []);
  let bladeIds = keys(scope.bladeIds ?? []);
  if (scope.app !== 'GREENSHED') {
    const bladeLinks = await rows(manager, 'blade_tray', [['blade_id', bladeIds]]);
    trayIds = keys([...trayIds, ...bladeLinks.filter(r => r.enabled && !r.deletedAt).map(r => r.tray_id)]);
    const trayLinks = await rows(manager, 'blade_tray', [['tray_id', trayIds], ['blade_id', bladeIds]]);
    bladeIds = keys([...bladeIds, ...trayLinks.filter(r => r.enabled && !r.deletedAt && trayIds.includes(String(r.tray_id))).map(r => r.blade_id)]);
    // A container's active blade set joins the scope, so receiving it can be undone as one change.
    const containerIds = keys(scope.containerIds ?? []);
    const containerSets = await rows(manager, 'container_sets', [['container_id', containerIds]]);
    const containerSetBlades = await rows(manager, 'container_set_blades', [['container_set_id', keys(containerSets.filter(r => r.enabled && !r.deletedAt).map(r => r.id))]]);
    bladeIds = keys([...bladeIds, ...containerSetBlades.filter(r => r.enabled && !r.deletedAt).map(r => r.blade_id)]);
    const buildLinks = await rows(manager, 'cutter_build_blades', [['blade_id', bladeIds], ['cutter_build_id', buildIds]]);
    const bodyBuilds = await rows(manager, 'cutter_builds', [['cutter_body_id', bodyIds]]);
    buildIds = keys([...buildIds, ...buildLinks.map(r => r.cutter_build_id), ...bodyBuilds.map(r => r.id)]);
    state.trays = await rows(manager, 'trays', [['id', trayIds]]);
    state.blades = await rows(manager, 'blades', [['id', bladeIds]]);
    state.blade_tray = await rows(manager, 'blade_tray', [['tray_id', trayIds], ['blade_id', bladeIds]]);
    state.location_tray = await rows(manager, 'location_tray', [['tray_id', trayIds]]);
    state.container_tray = await rows(manager, 'container_tray', [['tray_id', trayIds]]);
    state.container_set_blades = await rows(manager, 'container_set_blades', [['blade_id', bladeIds]]);
    state.container_sets = await rows(manager, 'container_sets', [['id', keys(state.container_set_blades.map(r => r.container_set_id))], ['container_id', containerIds]]);
    state.container_set_blades = await rows(manager, 'container_set_blades', [['blade_id', bladeIds], ['container_set_id', keys(state.container_sets.map(r => r.id))]]);
    state.tray_grinding_runs = await rows(manager, 'tray_grinding_runs', [['tray_id', trayIds]]);
    state.blade_history = await rows(manager, 'blade_history', [['tray_id', trayIds], ['blade_id', bladeIds]]);
    state.locations = await rows(manager, 'locations', [['id', keys([...state.location_tray, ...state.container_sets].map(r => r.location_id))]]);
    state.containers = await rows(manager, 'containers', [['id', keys([...state.container_tray, ...state.container_sets].map(r => r.container_id))]]);
    state.cutter_bodies = await rows(manager, 'cutter_bodies', [['id', bodyIds]]);
  }
  state.cutter_builds = await rows(manager, 'cutter_builds', [['id', buildIds]]);
  for (const table of CUTTER_TABLES.filter(t => !['cutter_builds', 'cutter_frequency_checks', 'cutter_cmm_checks'].includes(t))) {
    const conditions: Array<[string, string[]]> = [['cutter_build_id', buildIds]];
    if (table === 'cutter_build_trays') conditions.push(['tray_id', trayIds]);
    if (table === 'cutter_build_blades') conditions.push(['blade_id', bladeIds]);
    state[table] = await rows(manager, table, conditions);
  }
  const eventIds = (state.cutter_events ?? []).map(r => r.id); // always set by the loop above
  state.cutter_frequency_checks = await rows(manager, 'cutter_frequency_checks', [['event_id', eventIds]]);
  state.cutter_cmm_checks = await rows(manager, 'cutter_cmm_checks', [['event_id', eventIds]]);
  scope.bladeIds = bladeIds;
  scope.buildIds = buildIds;
  scope.trayIds = trayIds;
  return state;
}

// JSON object key order is immaterial; PostgreSQL jsonb and JS may enumerate it differently.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}

export function comparableSnapshot(state: Snapshot, app: ReversalApp): Snapshot {
  // Additive packing evidence must not invalidate pre-R25 snapshots that lack
  // these nullable columns. Actual non-null packing changes still block undo.
  if (state.container_tray) state = { ...state, container_tray: state.container_tray.map(row => {
    const copy = { ...row };
    if (copy.packed_from_location_id == null) delete copy.packed_from_location_id;
    if (copy.packed_at == null) delete copy.packed_at;
    return copy;
  }) };
  if (app !== 'GREENSHED') return state;
  // Count-only updates can be corrected by canceling the last inspection. Changes
  // to run identity, setup, checks, or pulls still block undo.
  return { ...state, cutter_machine_runs: (state.cutter_machine_runs ?? []).map(row => {
    const copy = { ...row };
    delete copy.current_piece_count;
    delete copy.updatedAt;
    delete copy.updatedBy;
    return copy;
  }) };
}

export async function beginWorkflowJournal(manager: EntityManager, input: ReversalScope, userId: string) {
  if (!manager.queryRunner?.isTransactionActive) throw new Error('Workflow journal requires a transaction');
  const scope: ReversalScope = JSON.parse(JSON.stringify(input));
  const before = await snapshot(manager, scope);
  const operationId = randomUUID();
  // Capture PostgreSQL OLD/NEW rows from this transaction only. Changes made by
  // another transaction during a snapshot read must never become part of an undo.
  await manager.query("SELECT set_config('dana.workflow_operation', $1, true)", [operationId]);
  return {
    async commit(identifier: string, action: string): Promise<void> {
      await manager.query("SELECT set_config('dana.workflow_operation', '', true)");
      const after = await snapshot(manager, scope);
      const changes = await manager.query('SELECT 1 FROM public.dana_workflow_changes_v1 WHERE operation_id = $1 LIMIT 1', [operationId]);
      if (!changes.length) return;
      await manager.query(
        `INSERT INTO public.dana_workflow_journal_v1
         (id, app, identifier, action, scope, before_state, after_state, created_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)`,
        [operationId, scope.app, identifier.trim(), action, JSON.stringify(scope), JSON.stringify(before), JSON.stringify(after), userId],
      );
    },
  };
}

async function latest(manager: EntityManager, app: ReversalApp, identifier: string): Promise<JournalRow | null> {
  const result = await manager.query(
    'SELECT * FROM public.dana_workflow_journal_v1 WHERE ' + lookupCondition(app) + ' ORDER BY created_at DESC, id DESC LIMIT 1',
    [app, identifier.trim()],
  );
  return result[0] ?? null;
}

function lookupCondition(app: ReversalApp): string {
  // A blade transfer affects both trays. Either serial must find that same
  // complete transaction; canceling restores the source and destination together.
  return app === 'BLADE_TRACKING'
    ? `app = $1 AND (identifier = $2 OR (scope->'trayIds') ? (SELECT id::text FROM public.trays WHERE serial_number = $2))`
    : 'app = $1 AND identifier = $2';
}

async function canCancel(manager: EntityManager, operation: JournalRow): Promise<boolean> {
  if (operation.canceled_at) return false;
  const live = await snapshot(manager, JSON.parse(JSON.stringify(operation.scope)));
  return canonical(comparableSnapshot(live, operation.app)) === canonical(comparableSnapshot(operation.after_state, operation.app));
}

async function displayOperation(manager: EntityManager, operation: JournalRow, eligible: boolean) {
  const names: Array<{ id: string; name: string }> = await manager.query(
    `SELECT id, NULLIF(trim(concat_ws(' ', "firstName", "lastName")), '') AS name FROM public.users WHERE id::text = ANY($1::text[])`,
    [keys([operation.created_by, operation.canceled_by])],
  );
  return {
    id: operation.id, identifier: operation.identifier, action: operation.action,
    occurred_at: operation.created_at, recorded_by: names.find(n => n.id === operation.created_by)?.name || operation.created_by,
    canceled_at: operation.canceled_at, canceled_by: names.find(n => n.id === operation.canceled_by)?.name || operation.canceled_by,
    cancellation_reason: operation.reason, can_cancel: eligible,
    blocked_reason: operation.canceled_at ? 'This transaction was canceled.' : eligible ? null : 'Later activity or changed records prevent cancellation.',
  };
}

export async function getWorkflowCancellation(source: DataSource, app: ReversalApp, identifier: string) {
  const manager = source.manager;
  const operation = await latest(manager, app, identifier);
  if (!operation) return { latest: null, history: [], message: 'No reversible transaction was recorded for this identifier. Transactions recorded before this update remain in the existing history.' };
  const history: JournalRow[] = await manager.query(
    'SELECT * FROM public.dana_workflow_journal_v1 WHERE ' + lookupCondition(app) + ' ORDER BY created_at DESC, id DESC LIMIT 20', [app, identifier.trim()],
  );
  return {
    latest: await displayOperation(manager, operation, await canCancel(manager, operation)),
    history: await Promise.all(history.map(row => displayOperation(manager, row, false))),
    message: null,
  };
}

export async function cancelWorkflow(source: DataSource, app: ReversalApp, identifier: string, operationId: string, reason: string, userId: string) {
  return source.transaction('READ COMMITTED', async manager => {
    // A rare cancellation briefly excludes concurrent inventory writes, including
    // older endpoints that do not share tray/run row locks. Normal reads continue.
    await manager.query('SET LOCAL lock_timeout = \'5s\'');
    await manager.query('LOCK TABLE ' + [...TABLES, ...READ_ONLY_TABLES].sort().map(t => 'public.' + quote(t)).join(', ') + ' IN SHARE ROW EXCLUSIVE MODE');
    const operation = await latest(manager, app, identifier);
    if (!operation || operation.id !== operationId) throw new ConflictException('The last transaction changed. Refresh before canceling.');
    if (!await canCancel(manager, operation)) throw new ConflictException('This transaction is already canceled or has later dependent activity. Refresh its history.');
    if (!reason.trim() || reason.trim().length > 1000) throw new ConflictException('Enter a cancellation reason of 1–1000 characters.');
    const changes: JournalChange[] = await manager.query('SELECT * FROM public.dana_workflow_changes_v1 WHERE operation_id = $1', [operation.id]);
    if (!changes.length || changes.some(change => !TABLES.includes(change.table_name) || !change.after_row)) {
      throw new ConflictException('The transaction has no complete reversible write history.');
    }

    // First close newly-created rows so unique active-assignment constraints permit
    // restoration of the old assignments. Original rows and measurements remain.
    for (const table of [...TABLES].reverse()) {
      for (const change of changes.filter(c => c.table_name === table && !c.before_row)) {
        const row = change.after_row!;
        // Measurements stay attached to the canceled event for inspection/history.
        if (['cutter_frequency_checks', 'cutter_cmm_checks'].includes(table)) continue;
        const set = ['"deletedAt" = clock_timestamp()', '"deletedBy" = $2', '"updatedAt" = clock_timestamp()', '"updatedBy" = $2'];
        if ('enabled' in row) set.push('enabled = false');
        if (table === 'cutter_builds') set.push('completed_at = clock_timestamp()');
        await manager.query('UPDATE public.' + quote(table) + ' SET ' + set.join(', ') + ' WHERE id = $1', [row.id, userId]);
      }
    }
    for (const table of TABLES) {
      for (const change of changes.filter(c => c.table_name === table && c.before_row)) {
        const before = change.before_row!;
        const after = change.after_row!;
        let changed = Object.keys(before).filter(key => canonical(before[key]) !== canonical(after[key]) && !['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'].includes(key));
        // Restore both inspection counts together below, including a check that
        // was entered at the same piece count and made no captured run change.
        if (app === 'GREENSHED' && table === 'cutter_machine_runs') changed = changed.filter(key => !['current_piece_count', 'last_check_piece_count'].includes(key));
        if (!changed.length) continue;
        const setters = changed.map((key, i) => quote(key) + ' = $' + (i + 3));
        await manager.query('UPDATE public.' + quote(table) + ' SET ' + [...setters, '"updatedAt" = clock_timestamp()', '"updatedBy" = $2'].join(', ') + ' WHERE id = $1', [before.id, userId, ...changed.map(key => before[key])]);
      }
    }
    if (app === 'GREENSHED') {
      const runs = (operation.before_state.cutter_machine_runs ?? []).filter(row => row.enabled && !row.deletedAt);
      const count = runs[0]?.last_check_piece_count;
      if (runs.length !== 1 || !Number.isSafeInteger(count) || Number(count) < 0) {
        throw new ConflictException('The previous check count could not be verified. No cancellation was applied.');
      }
      // last_check_piece_count holds the prior check, or the setup starting count
      // before the first check. Do not restore an intermediate production entry.
      if (dsfCutterCountsEnabled()) {
        // DSF credits production to this cutter, so its running count is not an inspection
        // entry: put back only the previous check point and leave the running count alone.
        await manager.query('UPDATE public.cutter_machine_runs SET last_check_piece_count = $2, "updatedAt" = clock_timestamp(), "updatedBy" = $3 WHERE id = $1', [runs[0].id, count, userId]);
      } else {
        await manager.query('UPDATE public.cutter_machine_runs SET current_piece_count = $2, last_check_piece_count = $2, "updatedAt" = clock_timestamp(), "updatedBy" = $3 WHERE id = $1', [runs[0].id, count, userId]);
      }
    }
    if (app === 'CUTTER_BUILDER') {
      for (const change of changes.filter(row => row.table_name === 'cutter_builds' && !row.before_row && row.after_row)) {
        await reverseCutterRequestAllocation(manager, change.row_id, userId, reason);
      }
    }
    await manager.query('UPDATE public.dana_workflow_journal_v1 SET canceled_at = clock_timestamp(), canceled_by = $2, reason = $3 WHERE id = $1', [operation.id, userId, reason.trim()]);
    const saved = await latest(manager, app, identifier);
    if (!saved) throw new NotFoundException('Cancellation history could not be loaded.');
    return displayOperation(manager, saved, false);
  }).catch(error => {
    if (['55P03', '40P01', '40001'].includes(error?.driverError?.code ?? error?.code)) {
      throw new ConflictException('Inventory is busy or changed during cancellation. Refresh the transaction and try again.');
    }
    throw error;
  });
}
