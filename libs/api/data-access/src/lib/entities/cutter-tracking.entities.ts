import {
  CheckCmm,
  CheckFrequency,
  CutterBuild,
  CutterLog,
  PullCutterReason,
  RetiredCutter,
} from '@meshforge/shared/domain';
import { EntitySchema } from 'typeorm';
import {
  bool,
  date,
  fk,
  int,
  manyToOne,
  num,
  sequenceInt,
  str,
  uuidPrimary,
} from './column-helpers';

export const CutterLogEntity = new EntitySchema<CutterLog>({
  name: 'Logs',
  columns: {
    id: uuidPrimary,
    build_id: str(),
    timestamp: date(),
    part_count: int(),
    toc_id: fk(),
    part_id: fk(),
    machine_id: fk(),
    user_id: fk(),
  },
  relations: {
    toc: manyToOne('Type_Of_Checks', 'toc_id', { eager: true }),
    part: manyToOne('Parts', 'part_id', { eager: true }),
    machine: manyToOne('Machines', 'machine_id', { eager: true }),
    user: manyToOne('Users', 'user_id', { eager: true }),
  },
});

export const PullCutterReasonEntity = new EntitySchema<PullCutterReason>({
  name: 'Pull_Cutter_Reasons',
  columns: { id: uuidPrimary, description: str() },
});

export const CutterBuildEntity = new EntitySchema<CutterBuild>({
  name: 'Cutter_Builds',
  columns: {
    id: uuidPrimary,
    part_type: str(),
    honed: bool(),
    coated: bool(),
    ib_ro: num(),
    ob_ro: num(),
    number: sequenceInt(),
    cutter_body_id: str(),
    comment: str(true),
    log_id: fk(),
    summary_id: fk(),
  },
  relations: {
    log: manyToOne('Logs', 'log_id', { eager: true }),
    summary: manyToOne('Summaries', 'summary_id', { eager: true }),
  },
});

const flankColumns = (prefix: 'flank_1' | 'flank_2') => ({
  [`${prefix}_Pa`]: num(),
  [`${prefix}_Sa`]: num(),
  [`${prefix}_Fp`]: num(),
  [`${prefix}__fp`]: num(),
  [`${prefix}_fu`]: num(),
  [`${prefix}_Frs`]: num(),
  [`${prefix}_warp`]: num(),
  [`${prefix}_toe_root`]: num(),
  [`${prefix}_toe_top`]: num(),
  [`${prefix}_heel_root`]: num(),
  [`${prefix}_heel_top`]: num(),
});

export const CheckCmmEntity = new EntitySchema<CheckCmm>({
  name: 'Check_CMMS',
  columns: {
    id: uuidPrimary,
    pass_fail: bool(),
    ...flankColumns('flank_1'),
    ...flankColumns('flank_2'),
    sum_Error_squared: num(),
    sum_Error_after: num(),
    result: num(),
    comment: str(true),
    log_id: fk(),
  },
  relations: { log: manyToOne('Logs', 'log_id', { eager: true }) },
});

export const CheckFrequencyEntity = new EntitySchema<CheckFrequency>({
  name: 'Check_Frequencies',
  columns: {
    id: uuidPrimary,
    pass_fail: bool(),
    s_e_sqaure: num(true),
    s_e_after: num(true),
    total_fr: num(true),
    tooth_thickness: num(true),
    flank1_pa: num(true),
    flank1_sa: num(true),
    flank2_pa: num(true),
    flank2_sa: num(true),
    size_check: num(true),
    comment: str(true),
    log_id: fk(),
  },
  relations: { log: manyToOne('Logs', 'log_id', { eager: true }) },
});

export const RetiredCutterEntity = new EntitySchema<RetiredCutter>({
  name: 'Retired_Cutters',
  columns: {
    id: uuidPrimary,
    cuttergrind_verified: bool(),
    comments: str(),
    log_id: fk(),
    pcr_id: fk(),
  },
  relations: {
    log: manyToOne('Logs', 'log_id', { eager: true }),
    pcr: manyToOne('Pull_Cutter_Reasons', 'pcr_id', { eager: true }),
  },
});
