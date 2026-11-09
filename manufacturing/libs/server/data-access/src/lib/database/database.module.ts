import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';

import { UserOrmEntity } from './entities/user.orm-entity';
import { UserOrmEntitySubscriber } from './subscribers/user.entity-subscriber';
import { LocationOrmEntity } from './entities/blade-tracking/location.orm-entity';
import { TrayOrmEntity } from './entities/blade-tracking/tray.orm-entity';
import { TrayStageOrmEntity } from './entities/blade-tracking/tray-stage.orm-entity';
import { TrayGrindingRunOrmEntity } from './entities/blade-tracking/tray-grinding-run.orm-entity';
import { ContainerOrmEntity } from './entities/blade-tracking/container.orm-entity';
import { BladeOrmEntity } from './entities/blade-tracking/blade.orm-entity';
import { BladeHistoryOrmEntity } from './entities/blade-tracking/blade-history.orm-entity';
import { PartSummaryOrmEntity } from './entities/base/part-summary.orm-entity';
import { PartOrmEntity } from './entities/base/part.orm-entity';
import { RollMasterOrmEntity } from './entities/base/roll-master.orm-entity';
import { ModelOrmEntity } from './entities/base/model.orm-entity';
import { DepartmentOrmEntity } from './entities/base/department.orm-entity';
import { MachineOrmEntity } from './entities/base/machine.orm-entity';
import { BladeTrayOrmEntity } from './entities/blade-tracking/blade-tray.orm-entity';
import { ContainerTrayOrmEntity } from './entities/blade-tracking/container-tray.orm-entity';
import { LocationTrayOrmEntity } from './entities/blade-tracking/location-tray.orm-entity';
import { CutterEventTypeOrmEntity } from './entities/cutter-tracking/cutter-event-type.orm-entity';
import { CutterBuildStatusOrmEntity } from './entities/cutter-tracking/cutter-build-status.orm-entity';
import { CutterPartTypeOrmEntity } from './entities/cutter-tracking/cutter-part-type.orm-entity';
import { CutterPullReasonOrmEntity } from './entities/cutter-tracking/cutter-pull-reason.orm-entity';
import { CutterBodyOrmEntity } from './entities/cutter-tracking/cutter-body.orm-entity';
import { CutterBodyDefinitionOrmEntity } from './entities/cutter-tracking/cutter-body-definition.orm-entity';
import { CutterLegacyOrphanRecordOrmEntity } from './entities/cutter-tracking/cutter-legacy-orphan-record.orm-entity';
import { CutterBuildOrmEntity } from './entities/cutter-tracking/cutter-build.orm-entity';
import { CutterBuildBladeOrmEntity } from './entities/cutter-tracking/cutter-build-blade.orm-entity';
import { CutterEventOrmEntity } from './entities/cutter-tracking/cutter-event.orm-entity';
import { CutterCmmCheckOrmEntity } from './entities/cutter-tracking/cutter-cmm-check.orm-entity';
import { CutterFrequencyCheckOrmEntity } from './entities/cutter-tracking/cutter-frequency-check.orm-entity';
import { CutterBladeRequirementOrmEntity } from './entities/cutter-tracking/cutter-blade-requirement.orm-entity';
import { CutterBuildTrayOrmEntity } from './entities/cutter-tracking/cutter-build-tray.orm-entity';
import { CutterTeardownOrmEntity } from './entities/cutter-tracking/cutter-teardown.orm-entity';
import { CutterBuildLocationOrmEntity } from './entities/cutter-tracking/cutter-build-location.orm-entity';
import { CutterCheckResultOrmEntity } from './entities/cutter-tracking/cutter-check-result.orm-entity';
import { CutterMachineRunOrmEntity } from './entities/cutter-tracking/cutter-machine-run.orm-entity';
import { CutterReferenceBootstrapService } from './seeds/cutter-reference.bootstrap';
import { WorkflowJournalBootstrap } from '../workflow-reversal';
import { GearMasterDataBootstrap } from '../gear-master-data.bootstrap';


const ormEventSubscribers: Provider[] = [UserOrmEntitySubscriber, GearMasterDataBootstrap, CutterReferenceBootstrapService, WorkflowJournalBootstrap];

const entities: EntityClassOrSchema[] = [
  UserOrmEntity,
  LocationOrmEntity,
  LocationTrayOrmEntity,
  TrayOrmEntity,
  TrayStageOrmEntity,
  TrayGrindingRunOrmEntity,
  ContainerOrmEntity,
  ContainerTrayOrmEntity,
  BladeOrmEntity,
  BladeHistoryOrmEntity,
  BladeTrayOrmEntity,
  PartSummaryOrmEntity,
  PartOrmEntity,
  RollMasterOrmEntity,
  ModelOrmEntity,
  DepartmentOrmEntity,
  MachineOrmEntity,
  CutterEventTypeOrmEntity,
  CutterBuildStatusOrmEntity,
  CutterPartTypeOrmEntity,
  CutterPullReasonOrmEntity,
  CutterBodyOrmEntity,
  CutterBodyDefinitionOrmEntity,
  CutterLegacyOrphanRecordOrmEntity,
  CutterBuildOrmEntity,
  CutterBuildBladeOrmEntity,
  CutterEventOrmEntity,
  CutterCmmCheckOrmEntity,
  CutterFrequencyCheckOrmEntity,
  CutterBladeRequirementOrmEntity,
  CutterBuildTrayOrmEntity,
  CutterTeardownOrmEntity,
  CutterBuildLocationOrmEntity,
  CutterCheckResultOrmEntity,
  CutterMachineRunOrmEntity,
];

const typeormModule = TypeOrmModule.forFeature(entities);

@Module({
  imports: [typeormModule],
  providers: [...ormEventSubscribers],
  exports: [typeormModule],
})
export class DatabaseModule {}
