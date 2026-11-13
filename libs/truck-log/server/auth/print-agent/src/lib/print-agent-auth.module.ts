import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrintAgentCredential } from '@truck-log/server/data-access';
import { PrintAgentAuthGuard } from './print-agent-auth.guard';

/** Owns authentication of the dedicated Windows Print Agent identity. */
@Module({
  imports: [TypeOrmModule.forFeature([PrintAgentCredential])],
  providers: [PrintAgentAuthGuard],
  exports: [PrintAgentAuthGuard],
})
export class PrintAgentAuthModule {}
