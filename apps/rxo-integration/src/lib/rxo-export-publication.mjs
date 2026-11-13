import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { looksLikeXlsx, mkdirp, sha256File, writeJson } from './rxo-export-runtime.mjs';

/**
 * Publication boundary for standard RXO exports. Batch acquisition writes only
 * into its private batch directory; these helpers own the final promotion into
 * /data/latest and the post-publish integrity verification.
 *
 * latest/ is never modified in place. A complete copy is staged in a fresh
 * sibling directory, verified, and swapped in with two renames of real
 * directories (no symlink, so `docker cp <c>:/data/latest/.` keeps working).
 * A reader therefore sees the old set, the new set, or (for the instant
 * between the renames) no latest/ at all - never a mix of two batches.
 */
const STAGING_PREFIX = '.latest-staging-';
const PREVIOUS_PREFIX = '.latest-previous-';

function copyFileToLatest(
  source,
  destination
) {
  mkdirp(
    path.dirname(
      destination
    )
  );

  fs.copyFileSync(
    source,
    destination
  );
  const fd = fs.openSync(destination, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function realDirectory(target) {
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`RXO publication refused: ${target} is not a real directory.`);
  }
  return true;
}

/**
 * Called with the export lock held: completes or rolls back a swap that a
 * killed exporter left half done, and removes abandoned staging copies.
 */
export function recoverLatestPublication(dataDir) {
  const latest = path.join(dataDir, 'latest');
  const leftovers = fs.existsSync(dataDir)
    ? fs.readdirSync(dataDir, { withFileTypes: true }).filter(entry => entry.isDirectory())
    : [];
  const previous = leftovers.filter(entry => entry.name.startsWith(PREVIOUS_PREFIX)).map(entry => entry.name).sort();
  if (!realDirectory(latest) && previous.length) {
    // Killed between the two renames: restore the last published set.
    fs.renameSync(path.join(dataDir, previous.pop()), latest);
    console.log('[RXO] Restored latest/ after an interrupted publication.');
  }
  for (const entry of leftovers) {
    if (entry.name.startsWith(STAGING_PREFIX) || entry.name.startsWith(PREVIOUS_PREFIX)) {
      fs.rmSync(path.join(dataDir, entry.name), { recursive: true, force: true });
    }
  }
}

export function publishLatestExports({ dataDir, productionPages, exportDirections, batchDir, manifest }) {
  recoverLatestPublication(dataDir);
  const latestRoot = path.join(dataDir, 'latest');
  const stagingRoot = path.join(dataDir, `${STAGING_PREFIX}${manifest.batchId}-${crypto.randomUUID()}`);
  const latestDir =
    path.join(
      stagingRoot,
      'fort-wayne'
    );

  const sourceRoot =
    path.join(
      batchDir,
      'fort-wayne'
    );

  try {
    for (
      const pageCase
      of productionPages
    ) {
      for (
        const direction
        of exportDirections
      ) {
        const source =
          path.join(
            sourceRoot,
            pageCase.exportKey,
            direction.file
          );

        const destination =
          path.join(
            latestDir,
            pageCase.exportKey,
            direction.file
          );

        copyFileToLatest(
          source,
          destination
        );
      }
    }

    writeJson(
      path.join(
        latestDir,
        'manifest.json'
      ),
      manifest
    );

    writeJson(
      path.join(
        stagingRoot,
        'manifest.json'
      ),
      {
        version:
          manifest.version,
        batchId:
          manifest.batchId,
        completedAt:
          manifest.completedAt,
        site:
          manifest.site,
        latestFortWaynePath:
          'fort-wayne/manifest.json',
      }
    );

    // The staged set must pass the same verification as the published one.
    verifyLatestExports({ dataDir, productionPages, exportDirections, latestRoot: stagingRoot,
      expectedBatchId: manifest.batchId, printManifest: false });

    const previous = path.join(dataDir, `${PREVIOUS_PREFIX}${crypto.randomUUID()}`);
    const hadLatest = realDirectory(latestRoot);
    if (hadLatest) fs.renameSync(latestRoot, previous);
    try {
      fs.renameSync(stagingRoot, latestRoot);
    } catch (error) {
      if (hadLatest) fs.renameSync(previous, latestRoot);
      throw error;
    }
    if (hadLatest) fs.rmSync(previous, { recursive: true, force: true });
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function requiredLatestFiles(latestRoot, productionPages, exportDirections) {
  const latestDir = path.join(
    latestRoot,
    'fort-wayne'
  );

  return [
    ...productionPages.flatMap(
      pageCase =>
        exportDirections.map(
          direction => ({
            kind: 'xlsx',
            pageKey: pageCase.exportKey,
            direction: direction.direction,
            file: path.join(
              latestDir,
              pageCase.exportKey,
              direction.file
            ),
          })
        )
    ),
    {
      kind: 'manifest',
      file: path.join(
        latestDir,
        'manifest.json'
      ),
    },
  ];
}

export function verifyLatestExports({ dataDir, productionPages, exportDirections, expectedBatchId = null, printManifest = false,
  latestRoot = path.join(dataDir, 'latest') }) {
  console.log('');
  console.log('============================================================');
  console.log('[RXO] VERIFYING LATEST FORT WAYNE OUTPUTS IN-PROCESS');
  console.log('============================================================');

  const results = [];

  for (const required of requiredLatestFiles(latestRoot, productionPages, exportDirections)) {
    if (!fs.existsSync(required.file)) {
      throw new Error(
        `Missing RXO output file: ${required.file}`
      );
    }

    const stat = fs.statSync(required.file);

    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(
        `Missing or empty RXO output file: ${required.file}`
      );
    }

    if (
      required.kind === 'xlsx' &&
      !looksLikeXlsx(required.file)
    ) {
      throw new Error(
        `RXO output is not a valid XLSX container: ${required.file}`
      );
    }

    results.push({
      ...required,
      bytes: stat.size,
      sha256:
        required.kind === 'xlsx'
          ? sha256File(required.file)
          : null,
    });

    const relative = path.relative(
      dataDir,
      required.file
    );

    console.log(
      `[PASS] /data/${relative.replaceAll('\\\\', '/')} (${stat.size} bytes)`
    );
  }

  const manifestPath = path.join(
    latestRoot,
    'fort-wayne',
    'manifest.json'
  );

  let manifest;
  try {
    manifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8')
    );
  } catch (error) {
    throw new Error(
      `Could not parse latest Fort Wayne manifest: ${error?.message || error}`
    );
  }

  if (manifest.status !== 'complete') {
    throw new Error(
      `Latest Fort Wayne manifest status is not complete: ${manifest.status}`
    );
  }

  if (!Array.isArray(manifest.exports) || manifest.exports.length !== 6) {
    throw new Error(
      `Latest Fort Wayne manifest must contain exactly 6 exports; found ${manifest.exports?.length ?? 'none'}.`
    );
  }

  if (
    expectedBatchId &&
    manifest.batchId !== expectedBatchId
  ) {
    throw new Error(
      `Latest Fort Wayne manifest batchId ${manifest.batchId} does not match completed batch ${expectedBatchId}.`
    );
  }

  const manifestKeys = new Set(
    manifest.exports.map(item =>
      `${item.pageKey}|${item.direction}`
    )
  );

  for (const pageCase of productionPages) {
    for (const direction of exportDirections) {
      const key = `${pageCase.key}|${direction.direction}`;
      if (!manifestKeys.has(key)) {
        throw new Error(
          `Latest manifest is missing export entry ${key}.`
        );
      }
    }
  }

  console.log(
    `[PASS] manifest.json parsed; batch ${manifest.batchId}; 6 export entries.`
  );

  if (printManifest) {
    console.log('');
    console.log('--- MANIFEST ---');
    console.log(JSON.stringify(manifest, null, 2));
  }

  console.log('============================================================');
  console.log('[RXO] ALL 6 FORT WAYNE EXPORTS VERIFIED IN-PROCESS');
  console.log('============================================================');

  return {
    manifest,
    files: results,
  };
}
