import { BaseEntity } from '../common/entity';
import { User } from '../auth/user';
import { Part } from './part';
import { Summary } from './summary';

export interface Gearset extends BaseEntity {
  number: string;
  rev: string | null;
  ratio: number | null;
  status: string;
  summary_id: string | null;
  summary?: Summary;
  pinion_id: string | null;
  pinion?: Part;
  ring_id: string | null;
  ring?: Part;
  user_id: string | null;
  user?: User;
  /**
   * Read-only master fields of a MeshForge assembly (public.gearsets); absent for a collector-only
   * number. `business_statuses` (e.g. Production, Service) is the business classification and is
   * separate from `status`, which says whether the record is usable (active/inactive).
   */
  ratio_text?: string | null;
  model?: string | null;
  customer?: string | null;
  application?: string | null;
  business_statuses?: string[];
  cut?: string | null;
  archived?: boolean;
}
/** Fields only MeshForge master data maintains; never accepted on create or update. */
export const GEARSET_MASTER_READ_ONLY_FIELDS = [
  'ratio_text', 'model', 'customer', 'application', 'business_statuses', 'cut', 'archived',
] as const;
export type CreateGearset = Pick<
  Gearset,
  'number' | 'rev' | 'summary_id' | 'pinion_id' | 'ring_id' | 'ratio' | 'status' | 'user_id'
>;
export type UpdateGearset = Partial<Pick<Gearset, 'rev' | 'status' | 'user_id'>>;
