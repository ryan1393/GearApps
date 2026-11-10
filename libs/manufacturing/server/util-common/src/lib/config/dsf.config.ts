/**
 * DSF (Digital Shop Floor) production-count switches.
 *
 * DSF_COUNT_ENABLED turns on the read-only DSF reader: counts are shown beside the existing
 * Greenshed counters and nothing else changes. DSF_CUTTER_WRITE_ENABLED additionally credits
 * that production to the cutter installed on each machine. The connection settings themselves
 * are read by the DSF reader in server/feat-greenshed (dsf-count), which also refuses unsafe
 * or incomplete combinations.
 */
export const ENV_DSF_COUNT_ENABLED = 'DSF_COUNT_ENABLED';
export const ENV_DSF_CUTTER_WRITE_ENABLED = 'DSF_CUTTER_WRITE_ENABLED';

/** True when DSF production is being credited to cutter runs, so DSF owns each cutter's running count. */
export function dsfCutterCountsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ENV_DSF_COUNT_ENABLED] === 'true' && env[ENV_DSF_CUTTER_WRITE_ENABLED] === 'true';
}
