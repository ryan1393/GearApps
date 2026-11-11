import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as https from 'node:https';
import { DataSource } from 'typeorm';
import {
  ARGONAUT_DEFAULT_TRANSACTION_TYPE_ID,
  argonautAddress,
  ArgonautPayload,
  ArgonautTestInput,
  ArgonautTestResult,
  buildArgonautPayload,
} from '@meshforge/shared/domain';

const TIMEOUT_MS = 10_000;
const REPLY_LIMIT = 2000;

/** What the Cycle Test Lab sends to Argonaut and where; built before anything leaves the server. */
export interface ArgonautTestRequest {
  url: string;
  payload: ArgonautPayload;
}

/**
 * Cycle Test Lab > Send to Argonaut. Sends one Track and Trace transaction built exactly as
 * Lapper Read builds a finished cycle's, so an Argonaut address can be checked without running a
 * machine. It records a real transaction in Argonaut, so it is admin-only and sent only on request.
 * Sign-in and certificate settings are the collector's (LAPPER_READ_ARGONAUT_* in .env).
 */
@Injectable()
export class ArgonautTestService {
  private readonly logger = new Logger(ArgonautTestService.name);

  constructor(private readonly db: DataSource, private readonly config: ConfigService) {}

  private setting(key: string): string {
    const value = this.config.get<unknown>(`LAPPER_READ_ARGONAUT_${key}`);
    return value == null ? '' : String(value).trim();
  }

  async prepare(input: ArgonautTestInput): Promise<ArgonautTestRequest> {
    const entries = Object.entries(input.values ?? {});
    if (entries.length > 2000) throw new BadRequestException('At most 2000 macro values are allowed.');
    const bad = entries.find(([key, value]) => !/^\d+$/.test(key) || typeof value !== 'number' || !Number.isFinite(value));
    if (bad) throw new BadRequestException(`Macro #${bad[0]} needs a finite number.`);

    const [machine] = await this.db.query(
      'SELECT argonaut_url, argonaut_location_id FROM lapper.machines WHERE id=$1 OR public_machine_id=$1 LIMIT 1',
      [input.machine_id],
    );
    const [gearset] = await this.db.query(
      `SELECT p.number FROM public.gearsets g JOIN public.parts p ON p.id=g.gearset_part_id WHERE g.id=$1
       UNION ALL SELECT number FROM lapper.gearsets WHERE id=$1 OR public_gearset_id=$1 LIMIT 1`,
      [input.gearset_id],
    );
    if (!machine || !gearset) throw new BadRequestException('Choose a configured lapping machine and gearset.');

    const override = input.url?.trim();
    const address = override || machine.argonaut_url?.trim() || this.setting('URL');
    if (!address) {
      throw new BadRequestException(
        'No Argonaut address. Enter one here, save one for the machine in Admin > Lapping machines, or set LAPPER_READ_ARGONAUT_URL.',
      );
    }
    const location = input.location_id?.trim() || machine.argonaut_location_id?.trim() || this.setting('LOCATION_ID');
    let url: string;
    try {
      url = argonautAddress(address, location);
    } catch (error) {
      throw new BadRequestException(error instanceof Error && error.message.startsWith('The Argonaut') ? error.message : 'The Argonaut address is not a valid URL.');
    }

    const partNumber = String(gearset.number ?? '').trim();
    const values: Record<string, number> = { ...input.values };
    // A real cycle reads the gearset number from #10020; default it to the chosen gearset.
    if (values['10020'] === undefined && /^\d+$/.test(partNumber)) values['10020'] = Number(partNumber);
    const type = Number(this.setting('TRANSACTION_TYPE_ID') || ARGONAUT_DEFAULT_TRANSACTION_TYPE_ID);
    const payload = buildArgonautPayload(input.serial_number.trim(), partNumber, input.sequence, values, type);
    return { url, payload };
  }

  async send(input: ArgonautTestInput, userId: string): Promise<ArgonautTestResult> {
    const { url, payload } = await this.prepare(input);
    const username = this.setting('USERNAME');
    const password = String(this.config.get<unknown>('LAPPER_READ_ARGONAUT_PASSWORD') ?? '');
    const verify = this.setting('VERIFY_TLS').toLowerCase() !== 'false';
    const sent_at = new Date().toISOString();
    const result = (ok: boolean, status: number | null, message: string, response = ''): ArgonautTestResult => {
      this.logger.log(`Cycle Test Lab Argonaut test by user ${userId}, serial ${payload.request.serialNumber}, to ${url}: ${message}`);
      return { ok, status, message, url, response: response.slice(0, REPLY_LIMIT), payload, sent_at };
    };
    try {
      const reply = await axios.post<string>(url, payload, {
        timeout: TIMEOUT_MS,
        maxRedirects: 0,
        responseType: 'text',
        transformResponse: (body) => body,
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' },
        ...(username || password ? { auth: { username, password } } : {}),
        // Argonaut servers often use a self-signed certificate on a plant IP address.
        httpsAgent: new https.Agent({ rejectUnauthorized: verify }),
      });
      const body = typeof reply.data === 'string' ? reply.data : JSON.stringify(reply.data ?? '');
      const ok = reply.status >= 200 && reply.status < 300;
      return result(ok, reply.status, ok ? `Argonaut accepted the transaction (HTTP ${reply.status}).` : `Argonaut answered HTTP ${reply.status}.`, body);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const hint = /self[- ]signed|certificate|unable to verify/i.test(reason) ? ' Set LAPPER_READ_ARGONAUT_VERIFY_TLS=false to accept a self-signed certificate.' : '';
      return result(false, null, `Argonaut is unreachable: ${reason}.${hint}`);
    }
  }
}
