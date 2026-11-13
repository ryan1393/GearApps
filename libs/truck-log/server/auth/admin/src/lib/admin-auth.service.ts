import { Injectable, HttpException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { returnedRows } from '@truck-log/server/data-access';
import {
  AdminFault, AdminRequest, Transport, ADMIN_VERSION, ADMIN_LOGIN_VERSION, SESSION_IDLE_MINUTES, SESSION_HOURS,
  loginIdentifier, username, email, displayName, password, verifyPassword, hashPassword,
  freshToken, cookieToken, csrfFor, sha256, sessionHash, fail, requireTransport, requireCsrf, transportConfig,
} from './admin-security';

type Queryable = Pick<EntityManager, 'query'>;
export type AdminUser = { id: string; username: string; email: string | null; displayName: string; enabled: boolean; mustChangePassword: boolean };
type UserRow = { id: string; username: string; email: string | null; display_name: string; password_hash: string;
  enabled: boolean; must_change_password: boolean; session_epoch: number; session_created?: Date | string };
export type AdminSession = { user: AdminUser; csrf: string; expiresAt: string };
export type AdminActor = { user: AdminUser; tokenHash: string };
const SELECT_USER = 'id, username, email, display_name, password_hash, enabled, must_change_password, session_epoch';
function publicUser(row: UserRow): AdminUser {
  return { id: row.id, username: row.username, email: row.email, displayName: row.display_name, enabled: row.enabled, mustChangePassword: row.must_change_password };
}
function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'ADMIN_INPUT', 'A JSON object is required.');
  return value as Record<string, unknown>;
}
function userId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(400, 'ADMIN_USER_ID', 'Invalid Truck Log administrator account.');
  return value;
}
@Injectable()
export class TruckLogAdminService {
  private readonly transport: Transport = transportConfig(process.env);
  constructor(private readonly db: DataSource) {}
  configStatus() { return { version: ADMIN_VERSION, loginVersion: ADMIN_LOGIN_VERSION, transport: this.transport.mode, origin: this.transport.origin, enabled: this.transport.enabled, configured: !!this.transport.origin, minimumPasswordLength: 15, maximumPasswordLength: 128 }; }
  cookieTransport(): Transport { return this.transport; }
  private async schema(q: Queryable = this.db) {
    const rows = await q.query('SELECT version FROM truck_log_admin.schema_version WHERE id = 1');
    if (rows.length !== 1 || rows[0].version !== ADMIN_VERSION) fail(503, 'ADMIN_SCHEMA_REQUIRED', 'Truck Log Admin account setup must be completed locally.');
  }
  private async audit(q: Queryable, action: string, actor: string | null, target: string | null, detail = '') {
    await q.query('INSERT INTO truck_log_admin.audit(action,actor_id,target_id,detail) VALUES ($1,$2,$3,$4)', [action, actor, target, detail]);
  }
  // Only FAILED sign-ins count, so nobody can lock administrators out by sending
  // requests with wrong passwords for other names, or by flooding the endpoint.
  private static readonly LIMITS = { client: 60, identifier: 10 };
  private throttleKeys(identifier: string, client: string) {
    return [[sha256('client:' + client), TruckLogAdminService.LIMITS.client], [sha256('identifier:' + identifier), TruckLogAdminService.LIMITS.identifier]] as const;
  }
  private async assertNotThrottled(identifier: string, client: string) {
    for (const [key, maximum] of this.throttleKeys(identifier, client)) {
      const rows = await this.db.query('SELECT attempts FROM truck_log_admin.login_limits WHERE key_hash=$1 AND expires_at > now()', [key]);
      if (rows.length && Number(rows[0].attempts) >= maximum) fail(429, 'ADMIN_RATE_LIMIT', 'Too many failed sign-in attempts. Wait 15 minutes before trying again.');
    }
  }
  private async recordFailure(identifier: string, client: string) {
    for (const [key] of this.throttleKeys(identifier, client)) {
      await this.db.query(`INSERT INTO truck_log_admin.login_limits(key_hash,attempts,expires_at)
        VALUES ($1,1,now()+interval '15 minutes') ON CONFLICT(key_hash) DO UPDATE SET
        attempts=CASE WHEN truck_log_admin.login_limits.expires_at <= now() THEN 1 ELSE truck_log_admin.login_limits.attempts+1 END,
        expires_at=CASE WHEN truck_log_admin.login_limits.expires_at <= now() THEN now()+interval '15 minutes' ELSE truck_log_admin.login_limits.expires_at END`, [key]);
    }
  }
  async login(req: AdminRequest, input: unknown): Promise<{ token: string; session: AdminSession }> {
    // requireTransport accepts a client assertion only from an authenticated,
    // explicitly trusted proxy. Public request headers cannot choose a throttle bucket.
    const client = requireTransport(req, this.transport, true), values = body(input), identity = loginIdentifier(values.identifier);
    await this.schema(); await this.assertNotThrottled(identity, client);
    const rows: UserRow[] = await this.db.query(`SELECT ${SELECT_USER} FROM truck_log_admin.users WHERE username=$1 OR email=$1`, [identity]);
    const row = rows.length === 1 ? rows[0] : null;
    const ok = await verifyPassword(values.password, row?.password_hash);
    if (!row || !row.enabled || !ok) {
      await this.recordFailure(identity, client);
      await this.audit(this.db, 'LOGIN_REJECTED', null, null);
      fail(401, 'ADMIN_LOGIN_FAILED', 'Username/email or password is incorrect, or the account is disabled.');
    }
    return this.db.transaction(async q => {
      const current: UserRow[] = await q.query(`SELECT ${SELECT_USER} FROM truck_log_admin.users WHERE id=$1 FOR UPDATE`, [row.id]);
      if (!current[0]?.enabled || current[0].password_hash !== row.password_hash || current[0].session_epoch !== row.session_epoch) fail(401, 'ADMIN_LOGIN_FAILED', 'Username/email or password is incorrect, or the account is disabled.');
      const previous = cookieToken(req.headers.cookie, this.transport);
      if (previous) await q.query('DELETE FROM truck_log_admin.sessions WHERE token_hash=$1', [sessionHash(previous, this.transport)]);
      const token = freshToken();
      const inserted = await q.query(`INSERT INTO truck_log_admin.sessions(token_hash,user_id,user_epoch,expires_at)
        VALUES ($1,$2,$3,now()+interval '${SESSION_HOURS} hours') RETURNING expires_at`, [sessionHash(token, this.transport), row.id, row.session_epoch]);
      await q.query(`DELETE FROM truck_log_admin.sessions WHERE expires_at <= now() OR last_seen_at <= now()-interval '${SESSION_IDLE_MINUTES} minutes'`);
      await q.query('DELETE FROM truck_log_admin.login_limits WHERE expires_at < now() OR key_hash=$1', [sha256('identifier:' + identity)]);
      await this.audit(q, 'LOGIN', row.id, row.id);
      return { token, session: { user: publicUser(current[0]), csrf: csrfFor(token), expiresAt: new Date(inserted[0].expires_at).toISOString() } };
    });
  }
  private async sessionRow(q: Queryable, hash: string, touch: boolean): Promise<UserRow & { expires_at: Date }> {
    const rows = await q.query(`SELECT u.*,s.expires_at,s.created_at AS session_created FROM truck_log_admin.sessions s
      JOIN truck_log_admin.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND u.enabled=true AND s.user_epoch=u.session_epoch
      AND s.expires_at>now() AND s.last_seen_at>now()-interval '${SESSION_IDLE_MINUTES} minutes'`, [hash]);
    if (rows.length !== 1) fail(401, 'ADMIN_SESSION_REQUIRED', 'Sign in to Truck Log Admin.');
    if (touch) await q.query('UPDATE truck_log_admin.sessions SET last_seen_at=now() WHERE token_hash=$1', [hash]);
    return rows[0];
  }
  async session(req: AdminRequest): Promise<AdminSession> {
    requireTransport(req, this.transport, false); await this.schema();
    const token = cookieToken(req.headers.cookie, this.transport); if (!token) fail(401, 'ADMIN_SESSION_REQUIRED', 'Sign in to Truck Log Admin.');
    const row = await this.sessionRow(this.db, sessionHash(token, this.transport), true);
    return { user: publicUser(row), csrf: csrfFor(token), expiresAt: new Date(row.expires_at).toISOString() };
  }
  async authorize(req: AdminRequest, allowPasswordChange = false, route = ''): Promise<AdminActor> {
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'POST');
    requireTransport(req, this.transport, mutating); await this.schema();
    const token = cookieToken(req.headers.cookie, this.transport); if (!token) fail(401, 'ADMIN_SESSION_REQUIRED', 'Sign in to Truck Log Admin.');
    if (mutating) requireCsrf(req, token);
    const row = await this.sessionRow(this.db, sessionHash(token, this.transport), true);
    if (row.must_change_password && !allowPasswordChange) fail(403, 'ADMIN_PASSWORD_CHANGE_REQUIRED', 'Change your temporary password before administering Truck Log.');
    if (route) await this.audit(this.db, 'ADMIN_ROUTE_AUTHORIZED', row.id, null, route.slice(0, 180));
    return { user: publicUser(row), tokenHash: sessionHash(token, this.transport) };
  }
  async logout(req: AdminRequest): Promise<void> {
    requireTransport(req, this.transport, true);
    const token = cookieToken(req.headers.cookie, this.transport); if (!token) return;
    requireCsrf(req, token); await this.schema();
    await this.db.transaction(async q => {
      const rows = returnedRows<{ user_id: string }>(await q.query('DELETE FROM truck_log_admin.sessions WHERE token_hash=$1 RETURNING user_id', [sessionHash(token, this.transport)]));
      if (rows[0]) await this.audit(q, 'LOGOUT', rows[0].user_id, rows[0].user_id);
    });
  }
  async list(req: AdminRequest): Promise<AdminUser[]> {
    await this.authorize(req);
    const rows = await this.db.query(`SELECT ${SELECT_USER} FROM truck_log_admin.users ORDER BY username LIMIT 1001`);
    if (rows.length > 1000) fail(409, 'ADMIN_LIST_LIMIT', 'Administrator list exceeds 1,000 accounts. Contact the maintainer.');
    return rows.map(publicUser);
  }
  private async lockedActor(q: Queryable, actor: AdminActor, changingOwnPassword = false) {
    await q.query("SELECT pg_advisory_xact_lock(hashtextextended('truck-log-admin-users-v1',0))");
    const row = await this.sessionRow(q, actor.tokenHash, false);
    if (row.id !== actor.user.id || (row.must_change_password && !changingOwnPassword)) fail(401, 'ADMIN_SESSION_REQUIRED', 'Sign in again before changing administrator accounts.');
    return row;
  }
  async create(req: AdminRequest, input: unknown): Promise<AdminUser> {
    const actor = await this.authorize(req), values = body(input);
    const name = displayName(values.displayName), handle = username(values.username), mail = email(values.email), hash = await hashPassword(values.password);
    return this.db.transaction(async q => {
      await this.lockedActor(q, actor);
      const rows = await q.query(`INSERT INTO truck_log_admin.users(id,username,email,display_name,password_hash)
        VALUES ($1,$2,$3,$4,$5) RETURNING ${SELECT_USER}`, [randomUUID(), handle, mail, name, hash]);
      await this.audit(q, 'CREATE_USER', actor.user.id, rows[0].id);
      return publicUser(rows[0]);
    });
  }
  async update(req: AdminRequest, id: string, input: unknown): Promise<AdminUser> {
    const actor = await this.authorize(req), values = body(input); userId(id);
    for (const key of Object.keys(values)) if (!['displayName','email','enabled'].includes(key)) fail(400, 'ADMIN_INPUT', 'Only display name, email, and enabled state are editable.');
    const name = values.displayName === undefined ? undefined : displayName(values.displayName);
    const mail = values.email === undefined ? undefined : email(values.email);
    if (values.enabled !== undefined && typeof values.enabled !== 'boolean') fail(400, 'ADMIN_INPUT', 'Enabled must be true or false.');
    return this.db.transaction(async q => {
      await this.lockedActor(q, actor);
      const rows: UserRow[] = await q.query(`SELECT ${SELECT_USER} FROM truck_log_admin.users WHERE id=$1 FOR UPDATE`, [id]);
      const target = rows[0]; if (!target) fail(404, 'ADMIN_USER_MISSING', 'Administrator account not found.');
      const enabled = values.enabled === undefined ? target.enabled : values.enabled as boolean;
      if (!enabled && target.enabled) {
        if (target.id === actor.user.id) fail(409, 'ADMIN_SELF_DISABLE', 'You cannot disable your own administrator account.');
        const count = await q.query('SELECT count(*)::integer AS count FROM truck_log_admin.users WHERE enabled=true');
        if (Number(count[0].count) <= 1) fail(409, 'ADMIN_LAST_ADMIN', 'The last enabled administrator cannot be disabled.');
      }
      const changedState = enabled !== target.enabled;
      const result = returnedRows<UserRow>(await q.query(`UPDATE truck_log_admin.users SET display_name=$2,email=$3,enabled=$4,
        session_epoch=session_epoch+$5,updated_at=now() WHERE id=$1 RETURNING ${SELECT_USER}`,
        [id, name ?? target.display_name, mail === undefined ? target.email : mail, enabled, changedState ? 1 : 0]));
      if (result.length !== 1) fail(404, 'ADMIN_USER_MISSING', 'Administrator account not found.');
      if (changedState) await q.query('DELETE FROM truck_log_admin.sessions WHERE user_id=$1', [id]);
      await this.audit(q, changedState ? (enabled ? 'ENABLE_USER' : 'DISABLE_USER') : 'UPDATE_USER', actor.user.id, id);
      return publicUser(result[0]);
    });
  }
  async reset(req: AdminRequest, id: string, input: unknown): Promise<void> {
    const actor = await this.authorize(req); userId(id);
    if (id === actor.user.id) fail(400, 'ADMIN_OWN_PASSWORD', 'Use Change my password for your own account.');
    const hash = await hashPassword(body(input).password);
    await this.db.transaction(async q => {
      await this.lockedActor(q, actor);
      const rows = returnedRows(await q.query(`UPDATE truck_log_admin.users SET password_hash=$2,must_change_password=true,
        session_epoch=session_epoch+1,updated_at=now() WHERE id=$1 RETURNING id`, [id, hash]));
      if (!rows[0]) fail(404, 'ADMIN_USER_MISSING', 'Administrator account not found.');
      await q.query('DELETE FROM truck_log_admin.sessions WHERE user_id=$1', [id]);
      await this.audit(q, 'RESET_PASSWORD', actor.user.id, id);
    });
  }
  async changePassword(req: AdminRequest, input: unknown): Promise<void> {
    const actor = await this.authorize(req, true), values = body(input);
    const client = requireTransport(req, this.transport, true);
    await this.assertNotThrottled('change:' + actor.user.id, client);
    const rows: UserRow[] = await this.db.query(`SELECT ${SELECT_USER} FROM truck_log_admin.users WHERE id=$1`, [actor.user.id]);
    const old = rows[0];
    if (!old || !await verifyPassword(values.currentPassword, old.password_hash)) {
      await this.recordFailure('change:' + actor.user.id, client);
      fail(401, 'ADMIN_CURRENT_PASSWORD', 'Current password is incorrect.');
    }
    const next = password(values.password);
    if (typeof values.currentPassword === 'string' && next === values.currentPassword.normalize('NFC')) fail(400, 'ADMIN_PASSWORD_REUSE', 'Choose a different password.');
    const hash = await hashPassword(next);
    await this.db.transaction(async q => {
      const current = await this.lockedActor(q, actor, true);
      if (current.password_hash !== old.password_hash) fail(409, 'ADMIN_ACCOUNT_CHANGED', 'Account changed. Sign in again.');
      await q.query(`UPDATE truck_log_admin.users SET password_hash=$2,must_change_password=false,
        session_epoch=session_epoch+1,updated_at=now() WHERE id=$1`, [actor.user.id, hash]);
      await q.query('DELETE FROM truck_log_admin.sessions WHERE user_id=$1', [actor.user.id]);
      await this.audit(q, 'CHANGE_PASSWORD', actor.user.id, actor.user.id);
    });
  }
  async safe<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof AdminFault) throw new HttpException({ code: error.code, message: error.message }, error.status);
      const code = (error as { code?: string })?.code;
      if (code === '23505') throw new HttpException({ code: 'ADMIN_DUPLICATE', message: 'That username or email is already assigned to a Truck Log account.' }, 409);
      // Do not expose passwords, SQL, parameter arrays, cookie values, or proxy keys in errors.
      throw new HttpException({ code: 'ADMIN_UNAVAILABLE', message: 'Administrator authentication is unavailable. Contact the Truck Log maintainer.' }, 503);
    }
  }
}
