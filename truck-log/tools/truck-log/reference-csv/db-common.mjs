import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export function workspaceRoot(fromDir) {
  return path.resolve(fromDir, '../../..');
}

export function loadDb(root) {
  const requireFromRoot = createRequire(path.join(root, 'package.json'));
  let pg;
  try { pg = requireFromRoot('pg'); }
  catch { throw new Error("PostgreSQL runtime package 'pg' is unavailable. Reinstall the locked dependencies or rebuild the Truck Log server image, then retry."); }

  const envFile = {};
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) {
    for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      envFile[k] = v;
    }
  }
  const get = (...keys) => {
    for (const k of keys) {
      if (process.env[k] != null && process.env[k] !== '') return process.env[k];
      if (envFile[k] != null && envFile[k] !== '') return envFile[k];
    }
  };
  const sslRaw = String(get('TRUCK_LOG_DATABASE_SSL','TRUCK_LOG_DB_SSL','DATABASE_SSL') || 'false').toLowerCase();
  const config = {
    host: get('TRUCK_LOG_DATABASE_HOST','TRUCK_LOG_DB_HOST','DATABASE_HOST') || '127.0.0.1',
    port: Number(get('TRUCK_LOG_DATABASE_PORT','TRUCK_LOG_DB_PORT','DATABASE_PORT') || 5432),
    user: get('TRUCK_LOG_DATABASE_USERNAME','TRUCK_LOG_DATABASE_USER','TRUCK_LOG_DB_USERNAME','TRUCK_LOG_DB_USER','DATABASE_USERNAME','DATABASE_USER') || 'postgres',
    password: get('TRUCK_LOG_DATABASE_PASSWORD','TRUCK_LOG_DB_PASSWORD','DATABASE_PASSWORD') || 'postgres',
    database: get('TRUCK_LOG_DATABASE_NAME','TRUCK_LOG_DB_NAME','DATABASE_NAME') || 'TruckLog',
    ssl: ['1','true','yes','require'].includes(sslRaw) ? { rejectUnauthorized:false } : false,
  };
  return { Client: pg.Client, config };
}

export const qid = (s) => '"' + String(s).replaceAll('"','""') + '"';
export const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g,' ');

export async function tableExists(client, table) {
  const r = await client.query('SELECT to_regclass($1) AS r', [`public.${table}`]);
  return Boolean(r.rows[0]?.r);
}

export async function tableColumns(client, table) {
  const r = await client.query(
    `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  return r.rows;
}

export async function tableCount(client, table) {
  if (!(await tableExists(client, table))) return null;
  const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${qid(table)}`);
  return Number(r.rows[0]?.n ?? 0);
}

export async function assertCurrentReferenceSchema(client) {
  if (!(await tableExists(client, 'truck_visits'))) throw new Error('public.truck_visits is missing.');
  const old = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='truck_visits' AND column_name='location_name'`,
  );
  if (old.rowCount) throw new Error('Obsolete truck_visits.location_name still exists. Bring the database to the current Truck Log migration baseline before using these tools.');
}

export async function foreignKeyEdges(client) {
  const r = await client.query(
    `SELECT parent.relname::text AS parent_table,
            child.relname::text AS child_table
       FROM pg_constraint con
       JOIN pg_class child ON child.oid = con.conrelid
       JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
       JOIN pg_class parent ON parent.oid = con.confrelid
       JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
      WHERE con.contype='f'
        AND child_ns.nspname='public'
        AND parent_ns.nspname='public'
        AND child.relkind IN ('r','p')
        AND parent.relkind IN ('r','p')`,
  );
  return r.rows.map(x => ({ parent:String(x.parent_table), child:String(x.child_table) }));
}

export function dependentClosure(startTables, edges) {
  const children = new Map();
  for (const {parent, child} of edges) {
    if (!children.has(parent)) children.set(parent, new Set());
    children.get(parent).add(child);
  }
  const seen = new Set(startTables);
  const queue = [...startTables];
  while (queue.length) {
    const parent = queue.shift();
    for (const child of children.get(parent) || []) {
      if (!seen.has(child)) { seen.add(child); queue.push(child); }
    }
  }
  return [...seen].sort();
}

export function protectedTableReason(table) {
  const exact = new Set([
    'app_settings','users','roles','permissions',
    'migrations','typeorm_metadata',
  ]);
  if (exact.has(table)) return 'protected configuration/auth/schema table';
  if (/^(auth_|user_|session|sessions|refresh_token|refresh_tokens)/i.test(table)) return 'protected authentication/session table';
  return '';
}

export async function assertMasterTable(client, table) {
  const rows = await tableColumns(client, table);
  const cols = new Set(rows.map(x => x.column_name));
  if (!cols.has('id') || !cols.has('name')) throw new Error(`Required Truck Log master table ${table}(id,name) was not found.`);
  const supported = new Set(['id','name','phone','active','last_used_at','created_at','updated_at']);
  const unsupportedRequired = rows.filter(x =>
    x.column_name !== 'id' && !supported.has(x.column_name) &&
    x.is_nullable === 'NO' && x.column_default == null
  );
  if (unsupportedRequired.length) {
    throw new Error(`${table} has unsupported required columns: ${unsupportedRequired.map(x=>x.column_name).join(', ')}`);
  }
  return cols;
}
