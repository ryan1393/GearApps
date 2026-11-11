// Test fixtures create accounts with passwords that are published in this repo
// (including an ADMIN account). They must never run against production.
// A machine opts in by putting MESHFORGE_ALLOW_TEST_ACCOUNTS=YES in its own .env.
export function assertTestAccountsAllowed(env, script) {
  const target = `${env.DATABASE_HOST}:${env.DATABASE_PORT}/${env.DATABASE_NAME}`;
  if (String(env.MESHFORGE_ALLOW_TEST_ACCOUNTS ?? '').trim() !== 'YES') {
    console.error(
      `[BLOCKED] ${script} would create test accounts with known passwords in ${target}.\n` +
        '          Only do this on a test database. To allow it on this machine, add\n' +
        '          MESHFORGE_ALLOW_TEST_ACCOUNTS=YES to its .env (never on production).',
    );
    process.exit(3);
  }
  console.log(`[INFO] ${script}: test accounts allowed for ${target}`);
}
