/** Each Admin tab is a child route: /admin/<tab>. */
export type AdminTab = 'access' | 'cycle-tests' | 'scanners' | 'macros' | 'fanuc-variables' | 'collector-tokens' | 'users' | 'part-summaries' | 'parts' | 'gearsets' | 'roll-masters' | 'models' | 'machines' | 'lapping-machines' | 'dsf-mappings' | 'label-printers' | 'coater-rpa' | 'launch' | 'server-settings' | 'trays' | 'containers' | 'locations' | 'cutter-bodies';

// Every tab, for routes and the old ?tab= deep links; `satisfies` keeps it in step with AdminTab.
export const ADMIN_TABS = ['access', 'cycle-tests', 'scanners', 'macros', 'fanuc-variables', 'collector-tokens', 'users', 'part-summaries', 'parts', 'gearsets', 'roll-masters', 'models', 'machines', 'lapping-machines', 'dsf-mappings', 'label-printers', 'coater-rpa', 'launch', 'server-settings', 'trays', 'containers', 'locations', 'cutter-bodies'] as const satisfies readonly AdminTab[];

export const DEFAULT_ADMIN_TAB: AdminTab = 'users';

export const isAdminTab = (value: unknown): value is AdminTab => ADMIN_TABS.includes(value as AdminTab);

export const isAdminRole = (role?: string | null): boolean => String(role ?? '').toLowerCase() === 'admin';
