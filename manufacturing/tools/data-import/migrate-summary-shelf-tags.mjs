import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const apply = process.argv.includes('--apply');

function loadDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}

const env = { ...loadDotEnv(path.join(projectRoot, '.env')), ...process.env };
for (const key of ['DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_USERNAME', 'DATABASE_PASSWORD', 'DATABASE_NAME']) {
  if (!env[key]) throw new Error(`${key} is required.`);
}
const client = new Client({ host: env.DATABASE_HOST, port: Number(env.DATABASE_PORT), user: env.DATABASE_USERNAME, password: String(env.DATABASE_PASSWORD), database: env.DATABASE_NAME });

const normalize = (value) => String(value ?? '').trim().toUpperCase();
const isSummary = (value) => /^(?=.*\d)[A-Z0-9.-]+$/.test(normalize(value));
const partLetter = (partType) => partType === 'RING' ? 'R' : 'P';

function explicitTarget(serial, summary) {
  const current = new Set([
    `GSR-${summary}`, `GSP-${summary}`,
    `CGDR-${summary}`, `CGDP-${summary}`,
    `CGFR-${summary}`, `CGFP-${summary}`,
  ]);
  if (current.has(serial)) {
    const partType = serial.startsWith('GSR-') || serial.startsWith('CGDR-') || serial.startsWith('CGFR-') ? 'RING' : 'PINION';
    return { current: true, target: serial, partType };
  }

  const fixed = [
    [`GSR${summary}`, `GSR-${summary}`, 'RING'],
    [`GSP${summary}`, `GSP-${summary}`, 'PINION'],
    [`CGDR${summary}`, `CGDR-${summary}`, 'RING'],
    [`CGDP${summary}`, `CGDP-${summary}`, 'PINION'],
    [`CGFR${summary}`, `CGFR-${summary}`, 'RING'],
    [`CGFP${summary}`, `CGFP-${summary}`, 'PINION'],
  ];
  for (const [legacy, target, partType] of fixed) {
    if (serial === legacy) return { current: false, target, partType };
  }
  return null;
}

async function inferLegacyPartType(locationId, summary, department) {
  let activeTypes;
  if (department === 'GREENSHED') {
    activeTypes = await client.query(`
      SELECT DISTINCT pt.code
        FROM cutter_build_locations cbl
        JOIN cutter_builds cb ON cb.id=cbl.cutter_build_id
        JOIN part_types pt ON pt.id=cb.part_type_id
       WHERE cbl.location_id=$1 AND cbl.enabled=true AND cb.completed_at IS NULL AND pt.enabled=true
       ORDER BY pt.code`, [locationId]);
  } else {
    activeTypes = await client.query(`
      SELECT DISTINCT pt.code
        FROM location_tray lt
        JOIN trays t ON t.id=lt.tray_id
        JOIN part_types pt ON pt.id=t.part_type_id
       WHERE lt.location_id=$1 AND lt.enabled=true AND t.enabled=true AND pt.enabled=true
       ORDER BY pt.code`, [locationId]);
  }

  let candidates = activeTypes.rows.map((row) => normalize(row.code)).filter((code) => code === 'RING' || code === 'PINION');
  let basis = candidates.length ? 'active placement' : 'Summary requirement';

  if (!candidates.length) {
    const requirementTypes = await client.query(`
      SELECT DISTINCT pt.code
        FROM cutter_blade_requirements r
        JOIN part_summaries s ON s.id=r.summary_id
        JOIN part_types pt ON pt.id=r.part_type_id
       WHERE r.enabled=true AND s.enabled=true AND UPPER(s.number)=$1
         AND pt.enabled=true AND pt.code IN ('RING','PINION')
       ORDER BY pt.code`, [summary]);
    candidates = requirementTypes.rows.map((row) => normalize(row.code));
  }
  return { candidates, basis };
}

async function activePlacementCount(locationId) {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM location_tray WHERE location_id=$1 AND enabled=true) AS tray_count,
      (SELECT COUNT(*)::int FROM cutter_build_locations WHERE location_id=$1 AND enabled=true) AS cutter_count`, [locationId]);
  const row = result.rows[0] ?? {};
  return Number(row.tray_count ?? 0) + Number(row.cutter_count ?? 0);
}

await client.connect();
try {
  if (apply) await client.query('BEGIN');
  const locations = await client.query(`
    SELECT id, serial_number, number, description, department, location_type, enabled
      FROM locations
     WHERE UPPER(COALESCE(location_type,''))='SHELF'
       AND UPPER(COALESCE(department,'')) IN ('GREENSHED','CUTTERGRIND')
     ORDER BY serial_number`);

  let current = 0, candidates = 0, safe = 0, renamed = 0, disabledDuplicate = 0, review = 0;

  for (const location of locations.rows) {
    const serial = normalize(location.serial_number);
    const summary = normalize(location.number);
    const department = normalize(location.department);

    if (!isSummary(summary)) {
      if (/^(G|GSR|GSP|CGE|CGER|CGEP|CGD|CGF)/i.test(serial)) {
        review += 1;
        console.log(`[REVIEW] ${location.serial_number}: location number '${location.number ?? ''}' is not a valid Summary. No change.`);
      }
      continue;
    }

    const obsoleteEmptyShelf = department === 'CUTTERGRIND' && [
      `CGE-${summary}`, `CGE${summary}`,
      `CGER-${summary}`, `CGER${summary}`,
      `CGEP-${summary}`, `CGEP${summary}`,
    ].includes(serial);
    if (obsoleteEmptyShelf) {
      review += 1;
      const placements = await activePlacementCount(location.id);
      console.log(`[REVIEW] ${location.serial_number}: obsolete empty-tray shelf. EMPTY/0-blade trays require no location. ${placements} active placement(s) currently use this row; clear/move any assignments and disable/delete the obsolete location manually. No automatic change.`);
      continue;
    }

    let resolved = explicitTarget(serial, summary);
    if (resolved?.current) { current += 1; continue; }

    if (!resolved && department === 'GREENSHED' && serial === `G${summary}`) {
      const inferred = await inferLegacyPartType(location.id, summary, department);
      if (inferred.candidates.length !== 1) {
        review += 1;
        console.log(`[REVIEW] ${location.serial_number}: cannot infer exactly one Part Type (${inferred.candidates.join(', ') || 'none'}). No change.`);
        continue;
      }
      const partType = inferred.candidates[0];
      resolved = { current: false, target: `${partType === 'RING' ? 'GSR' : 'GSP'}-${summary}`, partType, basis: inferred.basis };
    }

    if (!resolved && department === 'CUTTERGRIND') {
      const dull = serial === `CGD-${summary}` || serial === `CGD${summary}`;
      const finished = serial === `CGF-${summary}` || serial === `CGF${summary}`;
      if (dull || finished) {
        const inferred = await inferLegacyPartType(location.id, summary, department);
        if (inferred.candidates.length !== 1) {
          review += 1;
          console.log(`[REVIEW] ${location.serial_number}: cannot infer exactly one Part Type (${inferred.candidates.join(', ') || 'none'}). No change.`);
          continue;
        }
        const partType = inferred.candidates[0];
        const prefix = dull ? `CGD${partLetter(partType)}` : `CGF${partLetter(partType)}`;
        resolved = { current: false, target: `${prefix}-${summary}`, partType, basis: inferred.basis };
      }
    }

    if (!resolved) continue;
    if (department === 'GREENSHED' && !resolved.target.startsWith('GS')) { review += 1; console.log(`[REVIEW] ${location.serial_number}: department/tag mismatch for GREENSHED. No change.`); continue; }
    if (department === 'CUTTERGRIND' && !resolved.target.startsWith('CG')) { review += 1; console.log(`[REVIEW] ${location.serial_number}: department/tag mismatch for CUTTERGRIND. No change.`); continue; }

    candidates += 1;
    const existingTarget = await client.query('SELECT id, enabled FROM locations WHERE UPPER(serial_number)=$1 LIMIT 1', [resolved.target]);
    if (existingTarget.rows.length && existingTarget.rows[0].id !== location.id) {
      const placements = await activePlacementCount(location.id);
      if (placements > 0 || existingTarget.rows[0].enabled !== true) {
        review += 1;
        const reason = placements > 0 ? `${placements} active placement(s) remain on the legacy location` : 'the target exists but is disabled';
        console.log(`[REVIEW] ${location.serial_number}: ${resolved.target} already exists and ${reason}. No merge was attempted.`);
        continue;
      }
      safe += 1;
      console.log(`[SAFE] ${location.serial_number} -> disable legacy row; enabled target ${resolved.target} already exists.`);
      if (apply) {
        await client.query('UPDATE locations SET enabled=false, "updatedAt"=NOW() WHERE id=$1', [location.id]);
        disabledDuplicate += 1;
      }
      continue;
    }

    safe += 1;
    const reason = resolved.basis ? ` (${resolved.basis}: ${resolved.partType})` : '';
    console.log(`[SAFE] ${location.serial_number} -> ${resolved.target}${reason}.`);
    if (apply) {
      await client.query('UPDATE locations SET serial_number=$2, "updatedAt"=NOW() WHERE id=$1', [location.id, resolved.target]);
      renamed += 1;
    }
  }

  if (apply) await client.query('COMMIT');
  console.log('');
  console.log(`[${apply ? 'APPLY' : 'DRY RUN'}] current=${current} candidates=${candidates} safe=${safe} renamed=${renamed} disabled_duplicate=${disabledDuplicate} review=${review}`);
  if (!apply) console.log('Re-run with --apply to apply only SAFE rows. REVIEW rows are never guessed.');
  if (review) console.log('[REVIEW REQUIRED] One or more legacy Summary shelf rows could not be migrated safely.');
} catch (error) {
  if (apply) { try { await client.query('ROLLBACK'); } catch {} }
  throw error;
} finally {
  await client.end();
}
