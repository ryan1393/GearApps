import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnv } from './env.mjs';

loadEnv();

const { Client } = pg;

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
};

const db = new Client({
  host: required('TRUCK_LOG_DATABASE_HOST'),
  port: Number(required('TRUCK_LOG_DATABASE_PORT')),
  user: required('TRUCK_LOG_DATABASE_USERNAME'),
  password: required('TRUCK_LOG_DATABASE_PASSWORD'),
  database: required('TRUCK_LOG_DATABASE_NAME'),
  ssl: String(process.env.TRUCK_LOG_DATABASE_SSL || 'false').toLowerCase() === 'true'
    ? { rejectUnauthorized: false }
    : false,
});

const MOCK_PREFIX = 'MOCK-VISIT-';
const MOCK_ACTOR = 'MOCK-SEED';
const MOCK_DOCKS = [
  ['MOCK-01', '[MOCK] Receiving 1', true, 10],
  ['MOCK-02', '[MOCK] Receiving 2', true, 20],
  ['MOCK-03', '[MOCK] Shipping 1', true, 30],
  ['MOCK-04', '[MOCK] Shipping 2', true, 40],
  ['MOCK-05', '[MOCK] Overflow', true, 50],
  ['MOCK-06', '[MOCK] Returns', true, 60],
  ['MOCK-99', '[MOCK] Disabled Dock', false, 990],
];

// Older mock data used M01..M99. Clear/reset can safely remove those
// only when their descriptions are still tagged as mock data.
const LEGACY_MOCK_DOCK_CODES = ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M99'];

const storageRoot = path.resolve(process.env.TRUCK_LOG_DOCUMENT_STORAGE_ROOT || './data/documents');

const now = new Date();
const minutesAgo = (minutes) => new Date(now.getTime() - minutes * 60_000);
const daysAgo = (days, hour = 8, minute = 15) => {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

function safeJoinStorage(relativePath) {
  const absolute = path.resolve(storageRoot, ...relativePath.split('/'));
  const rootWithSep = storageRoot.endsWith(path.sep) ? storageRoot : storageRoot + path.sep;
  if (absolute !== storageRoot && !absolute.startsWith(rootWithSep)) {
    throw new Error(`Unsafe mock document path: ${relativePath}`);
  }
  return absolute;
}

function escapePdfText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function makeSimplePdf(lines) {
  const contentLines = ['BT', '/F1 12 Tf', '50 760 Td'];
  lines.forEach((line, index) => {
    if (index > 0) contentLines.push('0 -22 Td');
    contentLines.push(`(${escapePdfText(line)}) Tj`);
  });
  contentLines.push('ET');
  const content = contentLines.join('\n') + '\n';

  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';

  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

const visitTemplates = [
  // Active at docks
  {
    id: 1, status: 'DOCK_ASSIGNED', ageMinutes: 28, direction: 'INBOUND',
    load: 'IN-84271', carrier: 'Midwest Freight Lines', driver: 'Marcus Reed',
    tractor: 'MF-218', trailer: 'TRL-44018', drop: false,
    origin: 'Fort Wayne, IN', destination: 'Plant Receiving', dock: 'MOCK-01',
    location: 'Receiving', notes: 'Mock live inbound load.', scheduleOffset: -15,
    docs: ['Bill of Lading'],
  },
  {
    id: 2, status: 'DOCK_ASSIGNED', ageMinutes: 52, direction: 'INBOUND',
    load: 'IN-84272', carrier: 'Great Lakes Transport', driver: 'Daniel Ortiz',
    tractor: 'GL-774', trailer: 'GLT-99201', drop: true,
    origin: 'Detroit, MI', destination: 'Plant Receiving', dock: 'MOCK-02',
    location: 'Receiving', notes: 'Mock drop trailer.', scheduleOffset: 10,
    docs: [],
  },
  {
    id: 3, status: 'DOCK_ASSIGNED', ageMinutes: 18, direction: 'OUTBOUND',
    load: 'OUT-55120', carrier: 'Hoosier Logistics', driver: 'Tanya Brooks',
    tractor: 'HL-309', trailer: 'HLS-23880', drop: false,
    origin: 'Plant Shipping', destination: 'Columbus, OH', dock: 'MOCK-03',
    location: 'Shipping', notes: 'Mock outbound pickup.', scheduleOffset: -5,
    docs: ['Pickup Paperwork'],
  },
  {
    id: 4, status: 'DOCK_ASSIGNED', ageMinutes: 76, direction: 'OUTBOUND',
    load: 'OUT-55121', carrier: 'RoadStar Carriers', driver: 'Kevin Patel',
    tractor: 'RS-910', trailer: 'RSC-11745', drop: false,
    origin: 'Plant Shipping', destination: 'Louisville, KY', dock: 'MOCK-04',
    location: 'Shipping', notes: 'Mock outbound load running behind schedule.', scheduleOffset: -35,
    docs: [],
  },

  // Dock complete; waiting for final guard checkout
  {
    id: 5, status: 'DOCK_COMPLETE', ageMinutes: 96, dockCompleteAgo: 11, direction: 'INBOUND',
    load: 'IN-84268', carrier: 'Blue River Trucking', driver: 'Ashley Morgan',
    tractor: 'BR-442', trailer: 'BRT-71209', drop: false,
    origin: 'Indianapolis, IN', destination: 'Plant Receiving', dock: 'MOCK-05',
    location: 'Overflow', notes: 'Mock truck waiting at guard for final checkout.', scheduleOffset: -20,
    docs: ['Bill of Lading', 'Delivery Receipt'],
  },
  {
    id: 6, status: 'DOCK_COMPLETE', ageMinutes: 121, dockCompleteAgo: 7, direction: 'OUTBOUND',
    load: 'OUT-55118', carrier: 'Central States Express', driver: 'Brian Lewis',
    tractor: 'CS-106', trailer: 'CSE-88331', drop: false,
    origin: 'Plant Shipping', destination: 'Chicago, IL', dock: 'MOCK-03',
    location: 'Shipping', notes: 'Mock dock complete.', scheduleOffset: -40,
    docs: [],
  },
  {
    id: 7, status: 'DOCK_COMPLETE', ageMinutes: 64, dockCompleteAgo: 4, direction: 'INBOUND',
    load: 'IN-84270', carrier: 'Lakefront Freight', driver: 'Nicole Carter',
    tractor: 'LF-552', trailer: 'LFF-33210', drop: true,
    origin: 'Toledo, OH', destination: 'Plant Receiving', dock: 'MOCK-06',
    location: 'Returns', notes: 'Mock returns trailer.', scheduleOffset: 5,
    docs: ['Return Authorization'],
  },

  // History
  {
    id: 8, status: 'GUARD_CHECKED_OUT', historyDay: 0, hour: 7, duration: 88, direction: 'INBOUND',
    load: 'IN-84260', carrier: 'Midwest Freight Lines', driver: 'Rachel Kim',
    tractor: 'MF-201', trailer: 'TRL-43991', drop: false,
    origin: 'South Bend, IN', destination: 'Plant Receiving', dock: 'MOCK-01',
    location: 'Receiving', notes: 'Mock completed visit.', docs: ['Bill of Lading'],
  },
  {
    id: 9, status: 'GUARD_CHECKED_OUT', historyDay: 0, hour: 9, duration: 71, direction: 'OUTBOUND',
    load: 'OUT-55101', carrier: 'Hoosier Logistics', driver: 'Eric Thompson',
    tractor: 'HL-277', trailer: 'HLS-23802', drop: false,
    origin: 'Plant Shipping', destination: 'Dayton, OH', dock: 'MOCK-03',
    location: 'Shipping', notes: 'Mock completed visit.', docs: [],
  },
  {
    id: 10, status: 'GUARD_CHECKED_OUT', historyDay: 1, hour: 6, duration: 105, direction: 'INBOUND',
    load: 'IN-84242', carrier: 'Great Lakes Transport', driver: 'Samantha Price',
    tractor: 'GL-720', trailer: 'GLT-99142', drop: true,
    origin: 'Detroit, MI', destination: 'Plant Receiving', dock: 'MOCK-02',
    location: 'Receiving', notes: 'Mock completed drop-trailer visit.', docs: ['Bill of Lading', 'Packing List'],
  },
  {
    id: 11, status: 'GUARD_CHECKED_OUT', historyDay: 1, hour: 11, duration: 63, direction: 'OUTBOUND',
    load: 'OUT-55094', carrier: 'RoadStar Carriers', driver: 'Owen Foster',
    tractor: 'RS-864', trailer: 'RSC-11698', drop: false,
    origin: 'Plant Shipping', destination: 'Cincinnati, OH', dock: 'MOCK-04',
    location: 'Shipping', notes: 'Mock completed visit.', docs: [],
  },
  {
    id: 12, status: 'GUARD_CHECKED_OUT', historyDay: 2, hour: 8, duration: 94, direction: 'INBOUND',
    load: 'IN-84221', carrier: 'Blue River Trucking', driver: 'Megan Walsh',
    tractor: 'BR-401', trailer: 'BRT-71150', drop: false,
    origin: 'Muncie, IN', destination: 'Plant Receiving', dock: 'MOCK-05',
    location: 'Overflow', notes: 'Mock completed visit.', docs: ['Delivery Receipt'],
  },
  {
    id: 13, status: 'GUARD_CHECKED_OUT', historyDay: 2, hour: 13, duration: 77, direction: 'OUTBOUND',
    load: 'OUT-55082', carrier: 'Central States Express', driver: 'Andre Collins',
    tractor: 'CS-088', trailer: 'CSE-88276', drop: false,
    origin: 'Plant Shipping', destination: 'Nashville, TN', dock: 'MOCK-03',
    location: 'Shipping', notes: 'Mock completed visit.', docs: [],
  },
  {
    id: 14, status: 'GUARD_CHECKED_OUT', historyDay: 3, hour: 7, duration: 111, direction: 'INBOUND',
    load: 'IN-84199', carrier: 'Lakefront Freight', driver: 'Jason Miller',
    tractor: 'LF-501', trailer: 'LFF-33161', drop: false,
    origin: 'Toledo, OH', destination: 'Plant Receiving', dock: 'MOCK-06',
    location: 'Returns', notes: 'Mock completed returns visit.', docs: ['Return Authorization'],
  },
  {
    id: 15, status: 'GUARD_CHECKED_OUT', historyDay: 3, hour: 10, duration: 58, direction: 'OUTBOUND',
    load: 'OUT-55063', carrier: 'Hoosier Logistics', driver: 'Dana Spencer',
    tractor: 'HL-241', trailer: 'HLS-23720', drop: false,
    origin: 'Plant Shipping', destination: 'Lexington, KY', dock: 'MOCK-04',
    location: 'Shipping', notes: 'Mock completed visit.', docs: [],
  },
  {
    id: 16, status: 'GUARD_CHECKED_OUT', historyDay: 4, hour: 6, duration: 83, direction: 'INBOUND',
    load: 'IN-84171', carrier: 'Midwest Freight Lines', driver: 'Chris Nolan',
    tractor: 'MF-188', trailer: 'TRL-43832', drop: true,
    origin: 'Fort Wayne, IN', destination: 'Plant Receiving', dock: 'MOCK-01',
    location: 'Receiving', notes: 'Mock completed drop trailer.', docs: ['Bill of Lading'],
  },
  {
    id: 17, status: 'GUARD_CHECKED_OUT', historyDay: 4, hour: 14, duration: 69, direction: 'OUTBOUND',
    load: 'OUT-55045', carrier: 'RoadStar Carriers', driver: 'Lena Hayes',
    tractor: 'RS-811', trailer: 'RSC-11602', drop: false,
    origin: 'Plant Shipping', destination: 'Evansville, IN', dock: 'MOCK-03',
    location: 'Shipping', notes: 'Mock completed visit.', docs: [],
  },
  {
    id: 18, status: 'GUARD_CHECKED_OUT', historyDay: 5, hour: 9, duration: 124, direction: 'INBOUND',
    load: 'IN-84140', carrier: 'Great Lakes Transport', driver: 'Victor Ramirez',
    tractor: 'GL-681', trailer: 'GLT-99021', drop: false,
    origin: 'Lansing, MI', destination: 'Plant Receiving', dock: 'MOCK-02',
    location: 'Receiving', notes: 'Mock completed visit.', docs: ['Bill of Lading', 'Packing List'],
  },
  {
    id: 19, status: 'GUARD_CHECKED_OUT', historyDay: 6, hour: 12, duration: 92, direction: 'OUTBOUND',
    load: 'OUT-55012', carrier: 'Central States Express', driver: 'Emily Grant',
    tractor: 'CS-054', trailer: 'CSE-88114', drop: false,
    origin: 'Plant Shipping', destination: 'Grand Rapids, MI', dock: 'MOCK-04',
    location: 'Shipping', notes: 'Mock completed visit.', docs: [],
  },
];

function timesFor(template) {
  let checkIn;
  if (template.historyDay != null) {
    checkIn = daysAgo(template.historyDay, template.hour ?? 8, 15);
  } else {
    checkIn = minutesAgo(template.ageMinutes);
  }

  const dockAssigned = new Date(checkIn.getTime() + 3 * 60_000);
  let dockComplete = null;
  let guardCheckout = null;

  if (template.status === 'DOCK_COMPLETE') {
    dockComplete = minutesAgo(template.dockCompleteAgo);
  } else if (template.status === 'GUARD_CHECKED_OUT') {
    const duration = template.duration ?? 80;
    dockComplete = new Date(checkIn.getTime() + Math.max(30, duration - 15) * 60_000);
    guardCheckout = new Date(checkIn.getTime() + duration * 60_000);
  }

  const scheduleBase = template.scheduleOffset != null
    ? new Date(checkIn.getTime() + template.scheduleOffset * 60_000)
    : null;

  return { checkIn, dockAssigned, dockComplete, guardCheckout, scheduled: scheduleBase };
}

async function clearMockData() {
  const rows = await db.query(
    `SELECT document_folder_key
       FROM truck_visits
      WHERE visit_number LIKE $1`,
    [`${MOCK_PREFIX}%`],
  );

  await db.query('BEGIN');
  try {
    await db.query(`DELETE FROM truck_visits WHERE visit_number LIKE $1`, [`${MOCK_PREFIX}%`]);
    await db.query(`DELETE FROM scheduled_loads WHERE source = $1`, [MOCK_ACTOR]);

    await db.query(
      `DELETE FROM docks
        WHERE code = ANY($1::text[])
          AND description LIKE '[MOCK] %'`,
      [MOCK_DOCKS.map(([code]) => code)],
    );

    // Clean up only legacy mock docks whose descriptions are still visibly mock.
    // This prevents clear/reset from touching a real dock that merely shares a code.
    await db.query(
      `DELETE FROM docks
        WHERE code = ANY($1::text[])
          AND description LIKE 'Mock %'`,
      [LEGACY_MOCK_DOCK_CODES],
    );

    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }

  for (const row of rows.rows) {
    if (!row.document_folder_key || !String(row.document_folder_key).startsWith('mock/')) continue;
    const folder = safeJoinStorage(row.document_folder_key);
    fs.rmSync(folder, { recursive: true, force: true });
  }

  const mockRoot = safeJoinStorage('mock');
  if (fs.existsSync(mockRoot)) {
    try {
      const entries = fs.readdirSync(mockRoot);
      if (entries.length === 0) fs.rmdirSync(mockRoot);
    } catch {}
  }

  console.log(`[OK] Cleared ${rows.rowCount} mock visit(s) and their mock document folders.`);
}

async function seedMockData() {
  fs.mkdirSync(storageRoot, { recursive: true });

  // Never overwrite a real dock just because it shares a mock code.
  const existingMockCodeRows = await db.query(
    `SELECT code, description
       FROM docks
      WHERE code = ANY($1::text[])`,
    [MOCK_DOCKS.map(([code]) => code)],
  );
  const expectedDescriptions = new Map(MOCK_DOCKS.map(([code, description]) => [code, description]));

  for (const row of existingMockCodeRows.rows) {
    if (row.description !== expectedDescriptions.get(row.code)) {
      throw new Error(
        `Mock dock code ${row.code} already belongs to a non-mock dock. ` +
        `No mock rows were inserted. Change/remove that dock or adjust the mock seed first.`,
      );
    }
  }

  const createdFolders = [];

  await db.query('BEGIN');
  try {
    for (const [code, description, active, sortOrder] of MOCK_DOCKS) {
      await db.query(
        `INSERT INTO docks(code, description, active, sort_order)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(code) DO UPDATE
           SET active = EXCLUDED.active,
               sort_order = EXCLUDED.sort_order,
               updated_at = NOW()
         WHERE docks.description = EXCLUDED.description`,
        [code, description, active, sortOrder],
      );
    }

    for (const template of visitTemplates) {
      const visitNumber = `${MOCK_PREFIX}${String(template.id).padStart(3, '0')}`;
      const mockLoadNumber = `MOCK-${template.load}`;
      const folderKey = `mock/${visitNumber}`;
      const t = timesFor(template);
      const updatedAt = t.guardCheckout ?? t.dockComplete ?? t.dockAssigned;

      if (t.scheduled) {
        await db.query(
          `INSERT INTO scheduled_loads(load_number, scheduled_at, active, source, created_at, updated_at)
           VALUES($1,$2,true,$3,$4,$4)`,
          [mockLoadNumber, t.scheduled, MOCK_ACTOR, t.checkIn],
        );
      }

      const mockOrigin = template.direction === 'OUTBOUND' ? 'Fort Wayne' : template.origin;
      const mockDestination = template.direction === 'INBOUND' ? 'Fort Wayne' : template.destination;

      const visitResult = await db.query(
        `INSERT INTO truck_visits(
          visit_number, load_number, direction, carrier_name, driver_name,
          driver_phone, tractor_id, trailer_id, is_drop_trailer, origin_name,
          destination_name, dock_code, notes, status, document_folder_key,
          scheduled_at, guard_check_in_at, dock_assigned_at, dock_completed_at, guard_check_out_at,
          created_by, updated_by, created_at, updated_at
        )
        VALUES(
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, $22, $23, $24
        )
        RETURNING id`,
        [
          visitNumber,
          mockLoadNumber,
          template.direction,
          template.carrier,
          template.driver,
          `260-555-${String(1000 + template.id).slice(-4)}`,
          template.tractor,
          template.trailer,
          template.drop,
          mockOrigin,
          mockDestination,
          template.dock,
          template.notes,
          template.status,
          folderKey,
          t.scheduled,
          t.checkIn,
          t.dockAssigned,
          t.dockComplete,
          t.guardCheckout,
          MOCK_ACTOR,
          MOCK_ACTOR,
          t.checkIn,
          updatedAt,
        ],
      );

      const visitId = visitResult.rows[0].id;

      await db.query(
        `INSERT INTO visit_events(truck_visit_id,event_type,occurred_at,actor,notes,created_at)
         VALUES
           ($1,'GUARD_CHECK_IN',$2,$3,'Mock guard check-in',$2),
           ($1,'DOCK_ASSIGNED',$4,$3,$5,$4)`,
        [visitId, t.checkIn, MOCK_ACTOR, t.dockAssigned, `Dock ${template.dock}`],
      );

      if (t.dockComplete) {
        await db.query(
          `INSERT INTO visit_events(truck_visit_id,event_type,occurred_at,actor,notes,created_at)
           VALUES($1,'DOCK_COMPLETE',$2,$3,$4,$2)`,
          [visitId, t.dockComplete, MOCK_ACTOR, `Departed dock ${template.dock}`],
        );
      }

      if (t.guardCheckout) {
        await db.query(
          `INSERT INTO visit_events(truck_visit_id,event_type,occurred_at,actor,notes,created_at)
           VALUES($1,'FINAL_GUARD_CHECKOUT',$2,$3,'Mock final guard checkout',$2)`,
          [visitId, t.guardCheckout, MOCK_ACTOR],
        );
      }

      if (template.docs?.length) {
        const folder = safeJoinStorage(folderKey);
        fs.mkdirSync(folder, { recursive: true });
        createdFolders.push(folder);

        let docIndex = 0;
        for (const documentType of template.docs) {
          docIndex += 1;
          const safeType = documentType.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const fileName = `${safeType || 'paperwork'}.pdf`;
          const storedFileName = `mock-${String(docIndex).padStart(2, '0')}-${fileName}`;
          const relativePath = `${folderKey}/${storedFileName}`;
          const absolutePath = safeJoinStorage(relativePath);

          const pdf = makeSimplePdf([
            'TRUCK LOG MOCK PAPERWORK',
            `Document: ${documentType}`,
            `Visit: ${visitNumber}`,
            `Load: ${mockLoadNumber}`,
            `Driver: ${template.driver}`,
            `Carrier: ${template.carrier}`,
            `Trailer: ${template.trailer}`,
            `Dock: ${template.dock}`,
            'FAKE TEST DATA - NOT A REAL SHIPPING DOCUMENT',
          ]);

          fs.writeFileSync(absolutePath, pdf);

          const scannedAt = new Date(t.checkIn.getTime() + (5 + docIndex) * 60_000);
          await db.query(
            `INSERT INTO visit_documents(
              truck_visit_id,file_name,stored_file_name,relative_path,document_type,
              mime_type,file_size_bytes,page_count,scanned_at,scanned_by,created_at
            )
            VALUES($1,$2,$3,$4,$5,'application/pdf',$6,1,$7,$8,$7)`,
            [
              visitId,
              fileName,
              storedFileName,
              relativePath,
              documentType,
              pdf.length,
              scannedAt,
              MOCK_ACTOR,
            ],
          );

          await db.query(
            `INSERT INTO visit_events(truck_visit_id,event_type,occurred_at,actor,notes,created_at)
             VALUES($1,'DOCUMENT_ADDED',$2,$3,$4,$2)`,
            [visitId, scannedAt, MOCK_ACTOR, fileName],
          );
        }
      }
    }

    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    for (const folder of createdFolders) {
      try {
        fs.rmSync(folder, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup of files created before the transaction failed.
      }
    }
    throw error;
  }

  console.log('[OK] Seeded Truck Log mock dataset.');
}

async function printStatus() {
  const visits = await db.query(
    `SELECT status, COUNT(*)::int AS count
       FROM truck_visits
      WHERE visit_number LIKE $1
      GROUP BY status
      ORDER BY status`,
    [`${MOCK_PREFIX}%`],
  );

  const docks = await db.query(
    `SELECT active, COUNT(*)::int AS count
       FROM docks
      WHERE code = ANY($1::text[])
        AND description LIKE '[MOCK] %'
      GROUP BY active
      ORDER BY active DESC`,
    [MOCK_DOCKS.map(([code]) => code)],
  );

  const documents = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM visit_documents d
       JOIN truck_visits v ON v.id=d.truck_visit_id
      WHERE v.visit_number LIKE $1`,
    [`${MOCK_PREFIX}%`],
  );

  const scheduledLoads = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM scheduled_loads
      WHERE source = $1`,
    [MOCK_ACTOR],
  );

  console.log('');
  console.log('Truck Log mock data status');
  console.log('--------------------------');
  const statusMap = new Map(visits.rows.map((r) => [r.status, r.count]));
  console.log(`At dock .............. ${statusMap.get('DOCK_ASSIGNED') ?? 0}`);
  console.log(`Waiting for guard .... ${statusMap.get('DOCK_COMPLETE') ?? 0}`);
  console.log(`Checked out/history .. ${statusMap.get('GUARD_CHECKED_OUT') ?? 0}`);
  console.log(`Paperwork files ...... ${documents.rows[0]?.count ?? 0}`);
  console.log(`Scheduled loads ...... ${scheduledLoads.rows[0]?.count ?? 0}`);

  const dockMap = new Map(docks.rows.map((r) => [String(r.active), r.count]));
  console.log(`Active mock docks .... ${dockMap.get('true') ?? 0}`);
  console.log(`Disabled mock docks .. ${dockMap.get('false') ?? 0}`);
  console.log(`Document root ........ ${storageRoot}`);
  console.log('');
}

const command = String(process.argv[2] || 'status').toLowerCase();

await db.connect();

try {
  if (command === 'clear') {
    await clearMockData();
  } else if (command === 'seed') {
    const existing = await db.query(
      `SELECT COUNT(*)::int AS count FROM truck_visits WHERE visit_number LIKE $1`,
      [`${MOCK_PREFIX}%`],
    );

    if ((existing.rows[0]?.count ?? 0) > 0) {
      throw new Error(
        `Mock data already exists (${existing.rows[0].count} visit(s)). ` +
        `Use "reset" to clear and recreate it safely.`
      );
    }

    await seedMockData();
  } else if (command === 'reset') {
    await clearMockData();
    await seedMockData();
  } else if (command !== 'status') {
    throw new Error('Usage: node tools/truck-log/mock-data.mjs [seed|reset|clear|status]');
  }

  await printStatus();
} finally {
  await db.end();
}
