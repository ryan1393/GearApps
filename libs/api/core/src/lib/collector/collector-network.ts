import { lookup as dnsLookup, LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';

/**
 * Where the API hands the Docker collector its token: a file on a volume only the API and the
 * lapper-read container mount (compose sets LAPPER_READ_TOKEN_FILE). Empty outside Docker.
 */
export const dockerCollectorTokenFile = (env: NodeJS.ProcessEnv = process.env): string =>
  (env['LAPPER_READ_TOKEN_FILE'] ?? '').trim();

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
