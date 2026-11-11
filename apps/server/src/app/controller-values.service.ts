import { readFile } from 'node:fs/promises';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DataSource } from 'typeorm';
import { dockerCollectorTokenFile } from '@meshforge/api/postgres';
import { ARGONAUT_MACROS, ControllerMacroValues } from '@meshforge/shared/domain';

const TIMEOUT_MS = 25_000;

/**
 * Cycle Test Lab > Read values from machine. The API cannot talk to FANUC controllers, so it asks
 * Lapper Read, whose worker for the machine reads the macros between samples. The request carries
 * the Docker collector's own token, which only the API and the collector hold. Nothing is written.
 */
@Injectable()
export class ControllerValuesService {
  private readonly logger = new Logger(ControllerValuesService.name);

  constructor(private readonly db: DataSource, private readonly config: ConfigService) {}

  /** Argonaut's 68 macros plus the active macros in Admin > Macros. */
  async macroNumbers(): Promise<number[]> {
    const rows: { number: number }[] = await this.db.query('SELECT number FROM lapper.macros WHERE status = 1');
    return [...new Set([...ARGONAUT_MACROS, ...rows.map((r) => Number(r.number)).filter(Number.isInteger)])].sort((a, b) => a - b);
  }

  private async collectorToken(): Promise<string> {
    const file = dockerCollectorTokenFile();
    const token = file ? (await readFile(file, 'utf8').catch(() => '')).trim() : '';
    if (!token) {
      throw new ServiceUnavailableException(
        'The Docker collector is not connected. Click Connect Docker collector in Admin > Collector Tokens, then try again.',
      );
    }
    return token;
  }

  async read(machineId: string, userId: string): Promise<ControllerMacroValues> {
    const [machine] = await this.db.query(
      `SELECT pm.machine_number AS number FROM lapper.machines lm
         JOIN public.machines pm ON pm.id = lm.public_machine_id
        WHERE lm.id = $1 OR lm.public_machine_id = $1 LIMIT 1`,
      [machineId],
    );
    if (!machine) throw new BadRequestException('Choose a configured lapping machine.');
    const numbers = await this.macroNumbers();
    const base = String(this.config.get('LAPPER_READ_STATUS_URL') || 'http://lapper-read:8080').replace(/\/+$/, '');
    const url = `${base}/machines/${encodeURIComponent(machineId)}/macros?numbers=${numbers.join(',')}`;
    const token = await this.collectorToken();
    let reply;
    try {
      reply = await axios.get(url, {
        timeout: TIMEOUT_MS,
        proxy: false,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        validateStatus: () => true,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(`Lapper Read is not reachable at ${base} (${reason}). Is the collector running?`);
    }
    const message = typeof reply.data?.message === 'string' ? reply.data.message : `Lapper Read answered HTTP ${reply.status}.`;
    if (reply.status === 401) throw new ServiceUnavailableException(message);
    if (reply.status === 404 || reply.status === 400) throw new BadRequestException(message);
    if (reply.status !== 200 || typeof reply.data?.values !== 'object' || !reply.data.values) throw new BadGatewayException(message);
    const values: Record<string, number | null> = {};
    for (const n of numbers) {
      const raw = reply.data.values[String(n)];
      const value = raw == null || raw === '' ? NaN : Number(raw);
      values[String(n)] = Number.isFinite(value) ? value : null;
    }
    this.logger.log(`Cycle Test Lab: user ${userId} read ${numbers.length} macros from machine ${machine.number ?? machineId}`);
    return { machine_id: machineId, read_at: String(reply.data.read_at ?? new Date().toISOString()), values };
  }
}
