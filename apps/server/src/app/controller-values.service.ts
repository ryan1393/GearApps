import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { readFile } from 'node:fs/promises';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { BlockList, isIP } from 'node:net';
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

/** Loopback, private (RFC 1918 / unique local) and link-local networks: where a collector runs. */
const PRIVATE_NETWORKS = new BlockList();
for (const [network, prefix] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16]] as const)
  PRIVATE_NETWORKS.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['::1', 128], ['fc00::', 7], ['fe80::', 10]] as const)
  PRIVATE_NETWORKS.addSubnet(network, prefix, 'ipv6');

/** Whether `address` (an IP address) is on a loopback, private or link-local network. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && PRIVATE_NETWORKS.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void;
type Resolver = (hostname: string, options: { all: true }, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

/**
 * A DNS lookup for the connection to Lapper Read that fails unless every address the name
 * resolves to is private. It runs on the connection itself, so the check and the connection
 * use the same answer.
 */
export function privateNetworkLookup(resolve: Resolver = dnsLookup as unknown as Resolver) {
  return (hostname: string, options: { all?: boolean } | number, callback: LookupCallback): void => {
    resolve(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error);
      const outside = addresses.find((a) => !isPrivateAddress(a.address));
      if (!addresses.length || outside) {
        const refused = new Error(
          `${hostname} resolves to ${outside?.address ?? 'no address'}, outside the local and private networks; ` +
            'the collector token is only sent there',
        ) as NodeJS.ErrnoException;
        refused.code = 'ECOLLECTORHOST';
        return callback(refused);
      }
      if (typeof options === 'object' && options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

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
    // The request carries the Docker collector's token, so it only goes to the collector on this
    // host or the plant's private network (an IP there, or a name such as the compose service
    // that resolves there), never to an outside host the setting might name.
    const host = new URL(base).hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPrivateAddress(host)) {
      throw new ServiceUnavailableException(
        `LAPPER_READ_STATUS_URL (${base}) must be on this server or the private network; the collector token is not sent to ${host}.`,
      );
    }
    const token = await this.collectorToken();
    const lookup = privateNetworkLookup();
    let reply;
    try {
      reply = await axios.get(url, {
        timeout: TIMEOUT_MS,
        proxy: false,
        httpAgent: new HttpAgent({ lookup } as never),
        httpsAgent: new HttpsAgent({ lookup } as never),
        maxRedirects: 0,
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
