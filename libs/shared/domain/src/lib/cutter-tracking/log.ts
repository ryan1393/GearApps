import { BaseEntity } from '../common/entity';
import { User } from '../auth/user';
import { Machine } from '../gear/machine';
import { Part } from '../gear/part';
import { TypeOfCheck } from '../gear/type-of-check';

/** A cutter-tracking log entry: a check performed on a cutter build. */
export interface CutterLog extends BaseEntity {
  build_id: string;
  toc_id: string;
  toc?: TypeOfCheck;
  part_count: number;
  part_id: string;
  part?: Part;
  machine_id: string;
  machine?: Machine;
  user_id: string;
  user?: User;
  timestamp: Date | string;
}
export type CreateCutterLog = Pick<
  CutterLog,
  'build_id' | 'toc_id' | 'part_count' | 'part_id' | 'machine_id' | 'user_id' | 'timestamp'
>;
export type UpdateCutterLog = Partial<Omit<CutterLog, 'id' | 'toc' | 'part' | 'machine' | 'user'>>;
