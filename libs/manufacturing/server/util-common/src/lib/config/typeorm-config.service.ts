import { ENV_ENVIRONMENT } from '@meshforge/manufacturing/shared/util-constants';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { isValidatedEmptyBootstrap } from './schema-creation-policy';

@Injectable()
export class TypeormConfigService implements TypeOrmOptionsFactory {
  private logger = new Logger(TypeormConfigService.name);
  constructor(private configService: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const dbConfig = this.configService.get('db');
    if(dbConfig.type==='postgres' && dbConfig.synchronize && !isValidatedEmptyBootstrap()){
      throw new Error('DATABASE_SYNCHRONIZE must be false for shared PostgreSQL; use the explicit fresh-database bootstrap only for a new database');
    }
    this.logger.debug(
      `Database config loaded for env ${this.configService.get(ENV_ENVIRONMENT)} ` +
        `(type=${dbConfig.type}, host=${dbConfig.host ?? 'n/a'}, database=${
          dbConfig.type === 'better-sqlite3' ? dbConfig.path : dbConfig.name
        })`,
    );
    return {
      type: dbConfig.type,
      host: dbConfig.host,
      username: dbConfig.username,
      password: dbConfig.password,
      port: dbConfig.port,
      database: dbConfig.type === 'better-sqlite3' ? dbConfig.path : dbConfig.name,
      synchronize: dbConfig.synchronize,
      logging: dbConfig.logging,
      autoLoadEntities: true,
    };
  }
}
