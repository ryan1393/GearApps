import { BaseEntity } from '../common/entity';
import { User } from '../auth/user';
import { Summary } from './summary';

export const PART_TYPES = ['Pinion', 'Ring', 'Gearset'] as const;
export type PartType = (typeof PART_TYPES)[number];

export interface Part extends BaseEntity {
  number: string;
  type: PartType | string;
  summary_id: string | null;
  summary?: Summary;
  /** Tooth count for pinions/rings; ratio for gearsets. */
  teeth: number | null;
  status: string;
  user_id: string;
  user?: User;
  ring_id?: string | null;
  ring?: Part;
  pinion_id?: string | null;
  pinion?: Part;
}
export type CreatePart = Pick<
  Part,
  'number' | 'type' | 'summary_id' | 'teeth' | 'status' | 'user_id' | 'ring_id' | 'pinion_id'
>;
export type UpdatePart = Partial<Pick<Part, 'status' | 'user_id' | 'summary_id' | 'teeth'>>;
