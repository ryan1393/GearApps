import { Module } from '@nestjs/common';
import { RxoConnectionRecoveryService } from './lib/rxo-connection-recovery.service';
@Module({providers:[RxoConnectionRecoveryService],exports:[RxoConnectionRecoveryService]})
export class RxoConnectionRecoveryModule {}
export { RxoConnectionRecoveryService } from './lib/rxo-connection-recovery.service';
export { RxoRecoveryRuntime, runRecoveryDocker } from './lib/recovery-runtime';
export type { RecoveryDockerRun, RecoveryTarget } from './lib/recovery-runtime';
export type { RecoveryRole } from './lib/recovery-policy';
export type { RecoverOptions } from './lib/rxo-connection-recovery.service';
