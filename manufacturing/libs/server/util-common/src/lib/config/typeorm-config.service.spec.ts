import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TypeormConfigService } from './typeorm-config.service';

describe('TypeormConfigService', () => {
  let service: TypeormConfigService;
  let database: Record<string, unknown>;

  beforeEach(async () => {
    database = {
      type: 'postgres',
      host: 'database',
      port: 5432,
      name: 'GearApps',
      username: 'server',
      password: 'test-only',
      synchronize: false,
      logging: false,
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TypeormConfigService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'db' ? database : 'test'),
          },
        },
      ],
    }).compile();

    service = module.get<TypeormConfigService>(TypeormConfigService);
  });

  it('uses configured PostgreSQL credentials without enabling schema synchronization', () => {
    expect(service.createTypeOrmOptions()).toEqual({
      type: 'postgres',
      host: 'database',
      port: 5432,
      database: 'GearApps',
      username: 'server',
      password: 'test-only',
      synchronize: false,
      logging: false,
      autoLoadEntities: true,
    });
  });

  it('uses SQLite path for isolated tests instead of the PostgreSQL database name', () => {
    database['type'] = 'better-sqlite3';
    database['path'] = ':memory:';
    expect(service.createTypeOrmOptions()).toMatchObject({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: false,
    });
  });
});
