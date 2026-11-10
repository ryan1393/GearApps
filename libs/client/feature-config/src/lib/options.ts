import { MACRO_FORMS } from '@gearapps/shared/domain';
import { FORM_LABELS } from '@gearapps/client/feature-lapping-summary';

export const STATUS_OPTIONS = ['Active', 'Inactive'].map((s) => ({ label: s, value: s }));
export const ON_OFF_OPTIONS = [
  { label: 'ON', value: true },
  { label: 'OFF', value: false },
];
/** Macro `status` is stored as an integer flag. */
export const MACRO_STATUS_OPTIONS = [
  { label: 'Active', value: 1 },
  { label: 'Inactive', value: 0 },
];
export const MACRO_TYPES = ['real', 'int', 'bool'];
export const SCANNER_TYPES = ['Barcode', 'QR', 'Data Matrix'];
export const MACRO_FORM_OPTIONS = MACRO_FORMS.map((form) => ({
  value: form as string,
  label: FORM_LABELS[form] ?? form,
}));
export const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** The three Fanuc PLC signals Lapper reads, with their machine addresses. */
export const FANUC_SIGNALS = [
  { key: 'x06_7_frt_dr_closed', address: 'X6.7', label: 'Front door closed', short: 'Door' },
  { key: 'x01_2_start_cycle', address: 'X1.2', label: 'Cycle start', short: 'Start' },
  { key: 'y03_2_stack_inCycle', address: 'Y3.2', label: 'In cycle', short: 'In cycle' },
] as const;
export type FanucSignalKey = (typeof FANUC_SIGNALS)[number]['key'];
