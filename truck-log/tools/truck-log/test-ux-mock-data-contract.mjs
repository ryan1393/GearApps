import fs from 'node:fs';
import { readDanaUiStyles } from './source-contract-utils.mjs';

const read = (file) => fs.readFileSync(file, 'utf8');
const must = (condition, label) => {
  if (!condition) throw new Error(`[FAIL] ${label}`);
  console.log(`[OK] ${label}`);
};

const checkIn = (read('libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts') + '\n' + read('libs/truck-log/web/feature/check-in/src/lib/check-in.component.html'));
const dock = read('libs/truck-log/web/feature/dock-board/src/lib/dock-board.component.ts');
// Visual states (required tags, disabled/ready buttons, aged dock cards) are styled by @dana/ui;
// Truck Log keeps layout-only CSS.
const danaCss = readDanaUiStyles(process.cwd());
const dockCss = read('libs/truck-log/web/styles/src/styles/dock-board.css');
const dockerfile = read('docker/truck-log/server.Dockerfile');
const helper = read('tools/truck-log/run-mock-data-in-docker.cmd');
const load = read('LOAD-MOCK-DATA.cmd');
const reset = read('RESET-MOCK-DATA.cmd');
const clear = read('CLEAR-MOCK-DATA.cmd');
const status = read('MOCK-DATA-STATUS.cmd');

must(/<h2>Guard Notes<\/h2><span class="dana-field-tag">Optional<\/span>/.test(checkIn) && !/Guard Notes<\/h2><span class="dana-field-tag is-required">/.test(checkIn), 'Check-In optional details are clearly marked optional and kept out of the required count');
must(['carrierName', 'trailerId', 'originName', 'destinationName'].every((field) => checkIn.includes(`<span class="dana-field-tag" data-tone="info" *ngIf="selectedFreight && form.${field}.trim()">From RXO</span>`)) && danaCss.includes('.dana-field-tag[data-tone="info"]'), 'RXO-populated Check-In fields expose source badges');
must(checkIn.includes('<div class="dana-alert" [class.dana-alert-success]="canSave" aria-live="polite">')
  && checkIn.includes('[disabled]="!canSave || formDisabled || printingConfigLoading" (click)="save()"')
  && checkIn.includes('get formDisabled() { return this.saving || this.visitLocked; }')
  && checkIn.includes("printMode === 'AUTOMATIC' ? 'Check In & Print Slip' : 'Check In — Print Manually'"),
  'Check-In primary action retains ready styling, required-field/save locks, verified setup and an explicit label for each print mode');
must((checkIn.match(/<span class="dana-field-tag is-required">Required<\/span>/g) ?? []).length === 10 && danaCss.includes('.dana-field-tag.is-required'), 'Required fields expose a visible required marker');
must(checkIn.includes('class="dana-btn dana-btn-primary dana-btn-lg dana-btn-block"') && danaCss.includes('.dana-btn:disabled') && danaCss.includes('.dana-btn-primary:hover:not(:disabled)'), 'Check-In action has distinct locked and ready states');

must(dock.includes('<span class="dana-card-eyebrow">Dock</span><strong class="dana-card-title">{{visit.dockCode') && dock.includes('dockAgeLabel(visit)'), 'Dock card header presents Dock + number with an aging label');
must(dock.includes('Not attached (optional)') && dock.includes("'Upload PDF'"), 'Missing packing slip offers an explicit optional upload action');
must(dock.includes("a missing PDF doesn't block completion") && !dock.includes('|| !packingSlip(visit)'), 'Missing packing slip remains non-blocking for Dock Complete');
must(/\.tl-dock-grid \{[^}]*repeat\(auto-fill, minmax\(\d+px, 1fr\)\)/.test(dockCss) && /@media \(max-width: 760px\) \{[^}]*\.tl-dock-grid \{ grid-template-columns: 1fr; \}/.test(dockCss), 'Dock Board uses wide responsive desktop cards');
must(dock.includes('[attr.data-tone]="ageTone(visit)"') && danaCss.includes('.dana-card[data-tone="danger"]') && danaCss.includes('.dana-card[data-tone="warning"]'), 'Dock Board exposes warning/critical visual states');
must(/<ng-template #noPackingSlip>\s*<div class="dana-actions">\s*<button type="button" class="dana-btn dana-btn-primary"/.test(dock) && dock.includes('(click)="packingSlipInput.click()">{{uploadingVisitId===visit.id ? \'Reading PDF…\' : \'Upload PDF\'}}'), 'Missing packing-slip actions retain a visible primary button without becoming a workflow gate');

must(dockerfile.split('\n').some((line) => line.startsWith('COPY ') && line.includes('tools/truck-log/mock-data.mjs ')), 'Server runtime image contains mock-data tool');
must(helper.includes('docker exec -i truck-log-server node /app/tools/truck-log/mock-data.mjs %ACTION%'), 'Mock-data commands run inside the server container');
must(helper.includes('docker context show') && helper.includes('truck-log-server is not running'), 'Mock-data helper validates active Docker context/container state');
must(helper.includes('does not contain the mock-data runtime tool') && helper.includes('docker compose -p truck-log up -d --no-deps --build truck-log-server'), 'Missing runtime tool gives an explicit server rebuild instruction');
for (const [name, body, action] of [
  ['LOAD-MOCK-DATA.cmd', load, 'seed'],
  ['RESET-MOCK-DATA.cmd', reset, 'reset'],
  ['CLEAR-MOCK-DATA.cmd', clear, 'clear'],
  ['MOCK-DATA-STATUS.cmd', status, 'status'],
]) {
  must(body.includes('run-mock-data-in-docker.cmd" '+action), `${name} delegates ${action} to the Docker-safe helper`);
  must(!body.includes('node tools\\truck-log\\mock-data.mjs'), `${name} no longer tries to resolve Docker-only DB hostnames from Windows`);
}

console.log('[PASS] Truck Log UX + Docker-safe mock-data contract.');
