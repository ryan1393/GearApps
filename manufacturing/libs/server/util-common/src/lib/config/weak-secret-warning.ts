import { Logger } from '@nestjs/common';

const PLACEHOLDER = /change|example|placeholder|replace|secret$|^x+$/i;

/** Logs a loud warning when JWT secrets look like placeholders or are short. */
export function warnOnWeakJwtSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const weak = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'].filter((key) => {
    const value = env[key] ?? '';
    return value.length < 32 || PLACEHOLDER.test(value);
  });
  if (weak.length) {
    new Logger('Security').warn(
      `${weak.join(' and ')} ${weak.length > 1 ? 'look like placeholders or are' : 'looks like a placeholder or is'} shorter than 32 characters. ` +
        'Anyone who knows them can sign an admin login. Set long random values in .env and restart.',
    );
  }
  return weak;
}
