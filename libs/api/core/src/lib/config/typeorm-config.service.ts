import { Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { dbConfig } from './configuration';

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  private readonly logger = new Logger(TypeOrmConfigService.name);

  constructor(private readonly config: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const db = this.config.getOrThrow<ConfigType<typeof dbConfig>>('db');
    this.logger.log(
      `Database: ${db.type}${db.type === 'mssql' ? ` @ ${db.host}/${db.name}` : ` (${db.path})`}`,
    );

    const common = {
      autoLoadEntities: true,
      synchronize: db.synchronize,
      logging: db.logging,
    };

    if (db.type === 'better-sqlite3') {
      return { type: 'better-sqlite3', database: db.path, ...common };
    }

    return {
      type: 'mssql',
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: db.name,
      options: {
        trustServerCertificate: true,
        encrypt: false,
        instanceName: db.instanceName,
      },
      ...common,
    };
  }
}
