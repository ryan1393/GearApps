import { ConfigService } from '@nestjs/config';
import { TypeOrmConfigService } from './typeorm-config.service';
import { validationSchema } from './validation.schema';

describe('Shared GearApps PostgreSQL configuration', () => {
  const config = (synchronize = false) =>
    new TypeOrmConfigService(
      new ConfigService({
        db: {
          type: 'postgres',
          host: 'localhost',
          port: 5432,
          username: 'test',
          password: 'test',
          name: 'GearApps_test',
          synchronize,
          ssl: false,
          logging: false,
        },
      }),
    );

  it('never loads legacy ORM entities or synchronizes shared tables', () => {
    expect(config().createTypeOrmOptions()).toMatchObject({
      type: 'postgres',
      database: 'GearApps_test',
      entities: [],
      autoLoadEntities: false,
      synchronize: false,
    });
  });

  it('refuses accidental synchronization', () => {
    expect(() => config(true).createTypeOrmOptions()).toThrow('DATABASE_SYNCHRONIZE must be false');
  });

  it('rejects unknown historical timestamp zones', () => {
    const values = {
      DATABASE_TYPE: 'postgres',
      DATABASE_HOST: 'localhost',
      DATABASE_PORT: 5432,
      DATABASE_USERNAME: 'test',
      DATABASE_PASSWORD: 'test',
      DATABASE_NAME: 'GearApps_test',
      JWT_SECRET: 'a'.repeat(40),
    };
    expect(
      validationSchema.validate({ ...values, LAPPER_TIME_ZONE: 'Mars/Unknown' }).error,
    ).toBeDefined();
    expect(
      validationSchema.validate({ ...values, LAPPER_TIME_ZONE: 'America/Indianapolis' }).error,
    ).toBeUndefined();
  });
});
