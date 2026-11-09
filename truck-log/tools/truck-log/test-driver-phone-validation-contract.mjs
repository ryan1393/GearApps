import { readFeatureSource } from './source-contract-utils.mjs';
import fs from 'node:fs';
import { readDanaUiStyles } from './source-contract-utils.mjs';

const checkIn = (fs.readFileSync('libs/truck-log/web/feature/check-in/src/lib/check-in.component.ts', 'utf8') + '\n' + fs.readFileSync('libs/truck-log/web/feature/check-in/src/lib/check-in.component.html', 'utf8'));
const dto = fs.readFileSync('libs/truck-log/server/feature/visits/src/lib/dto/create-truck-visit.dto.ts', 'utf8');
// The visits lib splits TruckVisitsService into model/query/upload/RXO modules; read them together.
const service = readFeatureSource(process.cwd(), 'libs/truck-log/server/feature/visits/src/lib', ['.ts']);
const css = readDanaUiStyles(process.cwd());

const need = (condition, message) => {
  if (!condition) throw new Error(`[FAIL] ${message}`);
  console.log(`[PASS] ${message}`);
};

need(checkIn.includes('type="tel"'), 'Check-In Driver Phone uses tel input type');
need(checkIn.includes('inputmode="tel"'), 'Check-In Driver Phone requests a phone keypad');
need(checkIn.includes('required'), 'Check-In Driver Phone is semantically required');
need(checkIn.includes('maxlength="30"'), 'Check-In phone input has a bounded length');
need(checkIn.includes('get driverPhoneValid()'), 'Check-In has explicit phone validity logic');
need(checkIn.includes('digits.length >= 7 && digits.length <= 15'), 'Check-In requires 7-15 actual digits');
need(checkIn.includes("['Driver Phone', this.driverPhoneValid]"), 'Invalid phone remains incomplete in required-progress');
need(checkIn.includes('get canSave() { return this.missingRequiredItems.length === 0 && this.activeDocks.length > 0; }'), 'Required-item validation, including Driver Phone, blocks Check In & Print Slip');
need(checkIn.includes('normalizeDriverPhone()'), 'Check-In normalizes common US phone formatting');
need(checkIn.includes('Enter a valid phone number with 7–15 digits.'), 'Operator sees a clear invalid-phone message');

need(dto.includes('Matches'), 'API DTO validates allowed phone characters');
need(dto.includes('@MaxLength(30)'), 'API DTO bounds phone length');
need(service.includes('export function normalizeDriverPhone(value: string)'), 'API has server-side phone validation/normalization');
need(service.includes("digits.length < 7 || digits.length > 15"), 'API enforces 7-15 phone digits');
need(service.includes("Driver phone number must contain 7 to 15 digits."), 'API returns a clear phone validation error');

need(checkIn.includes('[class.is-invalid]="phoneTouched && !driverPhoneValid"') && css.includes('.dana-field.is-invalid input'), 'Dana UI visually marks invalid phone input');
need(checkIn.includes('class="dana-field-error"') && css.includes('.dana-field-error'), 'Dana UI styles phone validation guidance');

console.log('[PASS] Driver Phone is a real required phone-number field end-to-end.');
