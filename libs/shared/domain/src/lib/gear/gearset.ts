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
}
export type CreateGearset = Pick<
  Gearset,
  'number' | 'rev' | 'summary_id' | 'pinion_id' | 'ring_id' | 'ratio' | 'status' | 'user_id'
>;
export type UpdateGearset = Partial<Pick<Gearset, 'rev' | 'status' | 'user_id'>>;
