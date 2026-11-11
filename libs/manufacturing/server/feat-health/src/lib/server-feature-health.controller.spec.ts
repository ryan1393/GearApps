import { ServiceUnavailableException } from '@nestjs/common';
import { TerminusModule, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { MESHFORGE_VERSION } from '@meshforge/manufacturing/shared/util-constants';
import { ServerFeatureHealthController } from './server-feature-health.controller';

describe('ServerFeatureHealthController', () => {
  let module: TestingModule;
  let controller: ServerFeatureHealthController;
  const pingCheck = jest.fn();

  beforeEach(async () => {
    pingCheck.mockReset().mockResolvedValue({ database: { status: 'up' } });
    module = await Test.createTestingModule({
      imports: [TerminusModule.forRoot({ logger: false })],
      providers: [{ provide: TypeOrmHealthIndicator, useValue: { pingCheck } }],
      controllers: [ServerFeatureHealthController],
    }).compile();
    controller = module.get(ServerFeatureHealthController);
  });
  afterEach(async () => module.close());

  it('reports liveness without requiring a database connection', () => {
    expect(controller.live()).toEqual({ status: 'ok', service: 'meshforge-server', version: MESHFORGE_VERSION });
    expect(pingCheck).not.toHaveBeenCalled();
  });
  it('checks database readiness through the public Terminus service', async () => {
    expect(await controller.ready()).toMatchObject({ status: 'ok', details: { database: { status: 'up' } } });
    expect(pingCheck).toHaveBeenCalledWith('database');
  });
  it('retains unavailable status and the legacy health endpoint when the database is down', async () => {
    pingCheck.mockResolvedValue({ database: { status: 'down' } });
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
