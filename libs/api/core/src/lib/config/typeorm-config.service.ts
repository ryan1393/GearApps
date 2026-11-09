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
      `Database: ${db.type}${db.type === 'better-sqlite3' ? ` (${db.path})` : ` @ ${db.host}:${db.port ?? ''}/${db.name}`}`,
    );

    const common = {
      autoLoadEntities: true,
      synchronize: db.synchronize,
      logging: db.logging,
    };

    if (db.type === 'better-sqlite3') {
      return { type: 'better-sqlite3', database: db.path, ...common };
    }

    if (db.type === 'postgres') {
      return {
        type: 'postgres',
        host: db.host,
        port: db.port ?? 5432,
        username: db.username,
        password: db.password,
        database: db.name,
        schema: db.schema,
        ssl: db.ssl ? { rejectUnauthorized: false } : false,
        // gen_random_uuid() is built into Postgres 13+; avoids needing uuid-ossp.
        uuidExtension: 'pgcrypto',
        ...common,
      };
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
