import {
  CheckCmmEntity,
  CheckFrequencyEntity,
  CutterBuildEntity,
  CutterLogEntity,
  PullCutterReasonEntity,
  RetiredCutterEntity,
} from './cutter-tracking.entities';
import {
  DepartmentEntity,
  GearsetEntity,
  GearsetMarriageEntity,
  MachineCycleEntity,
  MachineEntity,
  MachineFanucVariableEntity,
  MacroEntity,
  MacroLogEntity,
  PartEntity,
  ScannerDetailEntity,
  SummaryEntity,
  TypeOfCheckEntity,
} from './gear.entities';
import { UserEntity } from './user.entity';

export * from './column-helpers';
export * from './user.entity';
export * from './gear.entities';
export * from './cutter-tracking.entities';

/** Every entity schema, registered once with TypeORM. */
export const ALL_ENTITIES = [
  UserEntity,
  DepartmentEntity,
  TypeOfCheckEntity,
  SummaryEntity,
  PartEntity,
  GearsetEntity,
  GearsetMarriageEntity,
  ScannerDetailEntity,
  MachineEntity,
  MachineCycleEntity,
  MachineFanucVariableEntity,
  MacroEntity,
  MacroLogEntity,
  CutterLogEntity,
  PullCutterReasonEntity,
  CutterBuildEntity,
  CheckCmmEntity,
  CheckFrequencyEntity,
  RetiredCutterEntity,
];
