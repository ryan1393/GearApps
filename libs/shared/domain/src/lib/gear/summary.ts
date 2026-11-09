import { BaseEntity } from '../common/entity';
import { User } from '../auth/user';

/** Part summary — groups parts/gearsets under a summary number, model and HOS. */
export interface Summary extends BaseEntity {
  number: string;
  model: string;
  hos: string;
  status: string;
  user_id: string;
  user?: User;
}
export type CreateSummary = Pick<Summary, 'number' | 'model' | 'hos' | 'status' | 'user_id'>;
export type UpdateSummary = Partial<Pick<Summary, 'status' | 'user_id'>>;
