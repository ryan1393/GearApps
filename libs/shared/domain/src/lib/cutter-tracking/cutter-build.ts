import { BaseEntity } from '../common/entity';
import { Summary } from '../gear/summary';
import { CutterLog } from './log';

export interface CutterBuild extends BaseEntity {
  log_id: string;
  log?: CutterLog;
  summary_id: string;
  summary?: Summary;
  part_type: string;
  honed: boolean;
  coated: boolean;
  ib_ro: number;
  ob_ro: number;
  /** Auto-incremented build number. */
  number: number;
  cutter_body_id: string;
  comment: string | null;
}
export type CreateCutterBuild = Pick<
  CutterBuild,
  | 'log_id'
  | 'summary_id'
  | 'part_type'
  | 'honed'
  | 'coated'
  | 'ib_ro'
  | 'ob_ro'
  | 'cutter_body_id'
  | 'comment'
>;
export type UpdateCutterBuild = Partial<Omit<CutterBuild, 'id' | 'number' | 'log' | 'summary'>>;
