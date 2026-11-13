import { RxoConnectionRecoveryModule } from '@truck-log/server/infrastructure/rxo-recovery';
import { Module } from '@nestjs/common';
import { RxoExpediteController } from './rxo-expedite.controller';
import { RxoExpediteService } from './rxo-expedite.service';

/** NestJS composition boundary for the independent RXO Expedite feature. */
@Module({
  imports: [RxoConnectionRecoveryModule],
  controllers: [RxoExpediteController],
  providers: [RxoExpediteService],
})
export class RxoExpediteModule {}

// Re-export the public feature types/classes so existing imports do not need to
// know how the implementation is split internally.
export { RxoExpediteController } from './rxo-expedite.controller';
export { RxoExpediteService } from './rxo-expedite.service';
export type { CredentialInput, ExpediteSettingsInput } from './rxo-expedite.types';
