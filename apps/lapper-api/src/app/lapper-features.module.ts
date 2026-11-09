import { AuthModule } from '@gearapps/api/feature-auth';
import { CutterTrackingModule } from '@gearapps/api/feature-cutter-tracking';
import { GearModule } from '@gearapps/api/feature-gear';
import { ScannerModule } from '@gearapps/api/feature-scanner';
import { PostgresLapperModule } from '@gearapps/api/postgres';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({})
export class LapperFeaturesModule {
  static async register(): Promise<DynamicModule> {
    await ConfigModule.envVariablesLoaded;
    return {
      module: LapperFeaturesModule,
      imports:
        process.env['DATABASE_TYPE'] === 'postgres'
          ? [PostgresLapperModule]
          : [AuthModule, GearModule, CutterTrackingModule, ScannerModule],
    };
  }
}
