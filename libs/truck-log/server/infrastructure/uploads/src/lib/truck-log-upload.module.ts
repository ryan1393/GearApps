import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const configuredMb = Number(config.get('TRUCK_LOG_MAX_DOCUMENT_MB', 25));
        const maxDocumentMb =
          Number.isFinite(configuredMb) && configuredMb > 0
            ? configuredMb
            : 25;

        return {
          limits: {
            files: 1,
            fileSize: Math.floor(maxDocumentMb * 1024 * 1024),
          },
        };
      },
    }),
  ],
  exports: [MulterModule],
})
export class TruckLogUploadModule {}
