import { BaseEntity } from '../common/entity';
import { CutterLog } from './log';

/** Pull Cutter Reason. */
export interface PullCutterReason extends BaseEntity {
  description: string;
}
export type CreatePullCutterReason = Pick<PullCutterReason, 'description'>;
export type UpdatePullCutterReason = Partial<CreatePullCutterReason>;

export interface RetiredCutter extends BaseEntity {
  log_id: string;
  log?: CutterLog;
  pcr_id: string;
  pcr?: PullCutterReason;
  cuttergrind_verified: boolean;
  comments: string;
}
export type CreateRetiredCutter = Pick<
  RetiredCutter,
  'log_id' | 'pcr_id' | 'cuttergrind_verified' | 'comments'
>;
export type UpdateRetiredCutter = Partial<CreateRetiredCutter>;
