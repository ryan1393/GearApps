import { ENV_ENVIRONMENT } from '@libs/shared/util-constants';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';

@Injectable()
export class TypeormConfigService implements TypeOrmOptionsFactory {
  private logger = new Logger(TypeormConfigService.name);
  constructor(private configService: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const dbConfig = this.configService.get('db');
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
