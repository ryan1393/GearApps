import { HttpException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { returnedRows } from '@truck-log/server/data-access';
import { randomUUID } from 'node:crypto';
import type { StationIdentity, StationKind, StationPairingResult, StationRecord, StationStatus } from '@truck-log/shared/contracts';
import {
  AttemptLimiter, PAIRING_MINUTES, StationFault, newPairingCode, newStationToken, normalizePairingCode,
  pairingCodeDigest, stationFail, stationKind, stationName, stationTokenDigest,
} from './station-security';

type StationRow = {
  id: string; name: string; kind: StationKind; token_sha256: string | null; pairing_expires_at: Date | null;
  created_at: Date; created_by: string | null; paired_at: Date | null; last_seen_at: Date | null; revoked_at: Date | null;
};
const COLUMNS = 'id, name, kind, token_sha256, pairing_expires_at, created_at, created_by, paired_at, last_seen_at, revoked_at';
const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);

function status(row: StationRow): StationStatus {
  if (row.revoked_at) return 'REVOKED';
  return row.token_sha256 ? 'ACTIVE' : 'WAITING_FOR_PAIRING';
}
function record(row: StationRow): StationRecord {
  return {
    id: row.id, name: row.name, kind: row.kind, status: status(row),
    createdAt: iso(row.created_at)!, createdBy: row.created_by, pairedAt: iso(row.paired_at),
    lastSeenAt: iso(row.last_seen_at), revokedAt: iso(row.revoked_at), pairingExpiresAt: iso(row.pairing_expires_at),
  };
}
function stationId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) stationFail(400, 'STATION_ID', 'Unknown station.');
  return value;
}

@Injectable()
export class StationAccessService {
  /** token digest -> identity, cached briefly so every API call is not a database round trip. */
  private readonly cache = new Map<string, { identity: StationIdentity | null; until: number }>();
  private readonly perClient = new AttemptLimiter(10, 5 * 60_000);
  private readonly overall = new AttemptLimiter(60, 5 * 60_000);

  constructor(private readonly db: DataSource) {}

  /** The station a token belongs to, or null. Updates last-seen at most every five minutes. */
  async identify(token: string): Promise<StationIdentity | null> {
    const digest = stationTokenDigest(token);
    const cached = this.cache.get(digest);
    if (cached && cached.until > Date.now()) return cached.identity;
    const rows = returnedRows<Pick<StationRow, 'id' | 'name' | 'kind'>>(await this.db.query(
      `UPDATE public.truck_log_stations SET last_seen_at = CASE
          WHEN last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes' THEN now() ELSE last_seen_at END
        WHERE token_sha256 = $1 AND revoked_at IS NULL RETURNING id, name, kind`, [digest]));
    const identity = rows.length === 1 ? { id: rows[0].id, name: rows[0].name, kind: rows[0].kind } : null;
    if (this.cache.size > 1000) this.cache.clear();
    this.cache.set(digest, { identity, until: Date.now() + 15_000 });
    return identity;
  }

  /** Exchange a one-time pairing code for a station token. */
  async pair(input: unknown, clientAddress: string): Promise<{ token: string; station: StationIdentity }> {
    // Per-client first, so one noisy client cannot use up the shared budget for everyone.
    if (!this.perClient.attempt(clientAddress) || !this.overall.attempt('all')) {
      stationFail(429, 'STATION_PAIR_RATE_LIMITED', 'Too many pairing attempts. Wait a few minutes and try again.');
    }
    const code = normalizePairingCode(typeof input === 'object' && input ? (input as { code?: unknown }).code : undefined);
    if (!code) stationFail(400, 'STATION_CODE_INVALID', 'That code is wrong or has expired. Ask an administrator for a new one.');
    const token = newStationToken();
    return this.db.transaction(async (q) => {
      const rows = returnedRows<StationRow>(await q.query(
        `UPDATE public.truck_log_stations
            SET token_sha256 = $2, pairing_code_sha256 = NULL, pairing_expires_at = NULL, paired_at = now(), last_seen_at = now()
          WHERE pairing_code_sha256 = $1 AND pairing_expires_at > now() AND revoked_at IS NULL
          RETURNING ${COLUMNS}`, [pairingCodeDigest(code), stationTokenDigest(token)]));
      if (rows.length !== 1) stationFail(400, 'STATION_CODE_INVALID', 'That code is wrong or has expired. Ask an administrator for a new one.');
      await this.event(q, rows[0].id, 'PAIRED', null, clientAddress);
      this.cache.clear();
      return { token, station: { id: rows[0].id, name: rows[0].name, kind: rows[0].kind } };
    });
  }

  async signOut(token: string, clientAddress: string): Promise<void> {
    const rows = returnedRows<{ id: string }>(await this.db.query(
      'UPDATE public.truck_log_stations SET token_sha256 = NULL WHERE token_sha256 = $1 RETURNING id', [stationTokenDigest(token)]));
    if (rows.length === 1) await this.event(this.db, rows[0].id, 'SIGNED_OUT', null, clientAddress);
    this.cache.clear();
  }

  async list(): Promise<StationRecord[]> {
    const rows: StationRow[] = await this.db.query(
      `SELECT ${COLUMNS} FROM public.truck_log_stations ORDER BY revoked_at IS NOT NULL, lower(name), created_at`);
    return rows.map(record);
  }

  async create(input: unknown, actor: string): Promise<StationPairingResult> {
    const body = (typeof input === 'object' && input ? input : {}) as { name?: unknown; kind?: unknown };
    const name = stationName(body.name), kind = stationKind(body.kind);
    const code = newPairingCode();
    try {
      return await this.db.transaction(async (q) => {
        const rows: StationRow[] = await q.query(
          `INSERT INTO public.truck_log_stations (id, name, kind, pairing_code_sha256, pairing_expires_at, created_by)
           VALUES ($1, $2, $3, $4, now() + interval '${PAIRING_MINUTES} minutes', $5) RETURNING ${COLUMNS}`,
          [randomUUID(), name, kind, pairingCodeDigest(code.replace('-', '')), actor]);
        await this.event(q, rows[0].id, 'CREATED', actor, null);
        await this.event(q, rows[0].id, 'PAIRING_CODE_ISSUED', actor, null);
        return { station: record(rows[0]), pairingCode: code, pairingExpiresAt: iso(rows[0].pairing_expires_at)! };
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') stationFail(409, 'STATION_NAME_TAKEN', 'A station with that name already exists.');
      throw error;
    }
  }

  /** New pairing code; the station is signed out until it pairs again. */
  async reissue(id: string, actor: string): Promise<StationPairingResult> {
    const code = newPairingCode();
    return this.db.transaction(async (q) => {
      const rows = returnedRows<StationRow>(await q.query(
        `UPDATE public.truck_log_stations
            SET token_sha256 = NULL, pairing_code_sha256 = $2, pairing_expires_at = now() + interval '${PAIRING_MINUTES} minutes'
          WHERE id = $1 AND revoked_at IS NULL RETURNING ${COLUMNS}`, [stationId(id), pairingCodeDigest(code.replace('-', ''))]));
      if (rows.length !== 1) stationFail(404, 'STATION_NOT_FOUND', 'That station does not exist or was revoked.');
      await this.event(q, rows[0].id, 'PAIRING_CODE_ISSUED', actor, null);
      this.cache.clear();
      return { station: record(rows[0]), pairingCode: code, pairingExpiresAt: iso(rows[0].pairing_expires_at)! };
    });
  }

  async revoke(id: string, actor: string): Promise<StationRecord> {
    return this.db.transaction(async (q) => {
      const rows = returnedRows<StationRow>(await q.query(
        `UPDATE public.truck_log_stations
            SET revoked_at = now(), revoked_by = $2, token_sha256 = NULL, pairing_code_sha256 = NULL, pairing_expires_at = NULL
          WHERE id = $1 AND revoked_at IS NULL RETURNING ${COLUMNS}`, [stationId(id), actor]));
      if (rows.length !== 1) stationFail(404, 'STATION_NOT_FOUND', 'That station does not exist or was already revoked.');
      await this.event(q, rows[0].id, 'REVOKED', actor, null);
      this.cache.clear();
      return record(rows[0]);
    });
  }

  private async event(q: Pick<DataSource, 'query'>, stationIdValue: string, action: string, actor: string | null, clientAddress: string | null) {
    await q.query('INSERT INTO public.truck_log_station_events (station_id, action, actor, client_address) VALUES ($1, $2, $3, $4)',
      [stationIdValue, action, actor ? actor.slice(0, 120) : null, clientAddress ? clientAddress.slice(0, 64) : null]);
  }

  /** Map known faults to HTTP errors without leaking SQL or secrets. */
  async safe<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) {
      if (error instanceof StationFault) throw new HttpException({ code: error.code, message: error.message }, error.status);
      if (error instanceof HttpException) throw error;
      throw new HttpException({ code: 'STATION_UNAVAILABLE', message: 'Station sign-in is unavailable. Contact the Truck Log maintainer.' }, 503);
    }
  }
}
