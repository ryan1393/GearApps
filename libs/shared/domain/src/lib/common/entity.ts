/** Every persisted entity has a UUID primary key. */
export interface BaseEntity {
  id: string;
}

/** Helpers for deriving create/update payload shapes from an entity. */
export type CreateDto<T extends BaseEntity, K extends keyof Omit<T, 'id'>> = Pick<T, K>;
export type UpdateDto<T extends BaseEntity, K extends keyof Omit<T, 'id'> = never> = Partial<
  Omit<T, 'id' | K>
>;
