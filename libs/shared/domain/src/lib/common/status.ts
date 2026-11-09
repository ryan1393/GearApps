export const ENTITY_STATUSES = ['Active', 'Inactive'] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];
