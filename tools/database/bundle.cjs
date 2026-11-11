const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { cleanupPlan } = require('./plan.cjs');
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const legacyDir = flag('--legacy-dir'),
  output = flag('--output');
if (!legacyDir || !output)
  throw new Error('Use --legacy-dir PATH --output PRIVATE_PACKAGE_DIRECTORY');
const legacySql = fs
  .readFileSync(path.join(legacyDir, 'merge-lapper.sql'), 'utf8')
  .replace(/\r\n/g, '\n');
const manifest = fs.readFileSync(path.join(legacyDir, 'SHA256SUMS.txt'), 'utf8');
const expected = manifest
  .split(/\r?\n/)
  .find((line) => /^[a-fA-F0-9]{64}\s+merge-lapper\.sql$/.test(line))
  ?.split(/\s+/)[0];
const originalBytes = fs.readFileSync(path.join(legacyDir, 'merge-lapper.sql'));
if (
  !expected ||
  createHash('sha256').update(originalBytes).digest('hex') !== expected.toLowerCase()
)
  throw new Error('Legacy merge SQL checksum failed');
const summary = JSON.parse(fs.readFileSync(path.join(legacyDir, 'merge-summary.json'), 'utf8'));
const sourceHash = summary.source_backup_sha256;
if (!/^[a-f0-9]{64}$/.test(sourceHash) || !legacySql.includes(sourceHash))
  throw new Error('Invalid legacy import identity');
function transactionBody(sql) {
  const start = sql.indexOf('\nBEGIN;\n'),
    end = sql.lastIndexOf('\nCOMMIT;');
  if (start < 0 || start > 512 || end < start) throw new Error('Unexpected transaction boundaries');
  return sql.slice(start + '\nBEGIN;\n'.length, end);
}
const combined = `\\set ON_ERROR_STOP on
-- Private package: contains the supplied legacy Lapper records. Keep out of source control.
BEGIN;
SET LOCAL lock_timeout='15s';
SET LOCAL statement_timeout='15min';
SELECT pg_advisory_xact_lock(hashtext('dana-gear-startup-schema'));
SELECT (to_regclass('lapper.import_batches') IS NOT NULL) AS gear_has_import_table \\gset
\\if :gear_has_import_table
  SELECT EXISTS(SELECT 1 FROM lapper.import_batches WHERE source_sha256='${sourceHash}') AS gear_import_done \\gset
\\else
  \\set gear_import_done false
\\endif
SELECT (to_regclass('meshforge_meta.schema_migrations') IS NOT NULL) AS gear_has_migrations \\gset
\\if :gear_has_migrations
  SELECT EXISTS(SELECT 1 FROM meshforge_meta.schema_migrations WHERE version='20261109-lapper-history-integrity-v2') AS gear_cleanup_done \\gset
\\else
  \\set gear_cleanup_done false
\\endif
\\if :gear_import_done
  \\echo 'Legacy import already recorded; preserving the current records.'
\\else
  \\if :gear_cleanup_done
    DO $unsupported_order$ BEGIN RAISE EXCEPTION 'Cleanup was applied before this legacy import; reconcile the import on staging before updating live data'; END $unsupported_order$;
  \\else
    \\ir legacy-import.sql
  \\endif
\\endif
${transactionBody(cleanupPlan())}
COMMIT;
ANALYZE;
`;
const target = path.resolve(output);
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'cleanup.sql'), combined);
// Keep COPY FROM stdin in an included file: psql cannot skip inline COPY data
// inside a false \\if branch. The include still runs inside the outer transaction.
fs.writeFileSync(path.join(target, 'legacy-import.sql'), transactionBody(legacySql));
for (const name of ['Apply-DatabaseCleanup.ps1', 'Apply-DatabaseCleanup.sh', 'validate.sql'])
  fs.writeFileSync(
    path.join(target, name),
    fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/\r\n/g, '\n'),
  );
fs.copyFileSync(path.join(__dirname, 'BUNDLE_README.txt'), path.join(target, 'README.txt'));
const names = [
  'cleanup.sql',
  'legacy-import.sql',
  'validate.sql',
  'Apply-DatabaseCleanup.ps1',
  'Apply-DatabaseCleanup.sh',
  'README.txt',
];
fs.writeFileSync(
  path.join(target, 'SHA256SUMS.txt'),
  names
    .map(
      (name) =>
        createHash('sha256')
          .update(fs.readFileSync(path.join(target, name)))
          .digest('hex') +
        '  ' +
        name,
    )
    .join('\n') + '\n',
);
console.log('Wrote private merge-and-cleanup package: ' + target);
