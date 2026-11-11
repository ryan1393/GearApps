const fs = require('node:fs');
const path = require('node:path');
const { databaseSource } = require('./runtime.cjs');
const { auditGearDatabase } = require('@meshforge/shared/database');
const { cleanupPlan } = require('./plan.cjs');
async function main() {
  const command = process.argv[2] || 'audit';
  const outputIndex = process.argv.indexOf('--output');
  const output = outputIndex < 0 ? undefined : process.argv[outputIndex + 1];
  if (outputIndex >= 0 && !output) throw new Error('--output requires a file path');
  let text;
  if (command === 'plan') text = cleanupPlan();
  else if (command === 'audit') {
    const source = databaseSource();
    await source.initialize();
    try {
      const report = await auditGearDatabase(source);
      text = JSON.stringify(report, null, 2) + '\n';
      if (report.status === 'failed') process.exitCode = 2;
    } finally {
      await source.destroy();
    }
  } else
    throw new Error(
      'Use audit or plan. Apply a reviewed plan with the backup-first PowerShell script.',
    );
  if (output) {
    const target = path.resolve(output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    console.log('Wrote ' + target);
  } else process.stdout.write(text);
}
main().catch((error) => {
  console.error('[FAIL] ' + error.message);
  process.exitCode = 1;
});
