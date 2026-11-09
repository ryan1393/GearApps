import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BaseCrudService } from './base-crud.service';

interface Thing {
  id: string;
  name: string;
}

class ThingService extends BaseCrudService<Thing> {
  constructor(repo: Repository<Thing>) {
    super(repo, 'Thing');
  }
}

const repoMock = () => {
  const store = new Map<string, Thing>();
  return {
    store,
    metadata: { name: 'Thing' },
    find: jest.fn(async () => [...store.values()]),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null),
    create: jest.fn((d: Thing) => d),
    save: jest.fn(async (d: Partial<Thing>) => {
      const t = { ...(store.get(d.id ?? '') ?? {}), ...d } as Thing;
      store.set(t.id, t);
      return t;
    }),
    remove: jest.fn(async (t: Thing) => {
      store.delete(t.id);
      return t;
    }),
  } as unknown as Repository<Thing> & { store: Map<string, Thing> };
};

describe('BaseCrudService', () => {
  it('creates, reads, updates and removes', async () => {
    const repo = repoMock();
    const svc = new ThingService(repo);
    await svc.create({ id: 'a', name: 'one' });
    expect((await svc.findAll()).map((t) => t.name)).toEqual(['one']);
    expect((await svc.update('a', { name: 'two' })).name).toBe('two');
    await svc.remove('a');
    await expect(svc.findOne('a')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('upsert rejects a body id that disagrees with the URL id', async () => {
    const svc = new ThingService(repoMock());
    await expect(svc.upsert('a', { id: 'b', name: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('upsert creates when the id is new', async () => {
    const repo = repoMock();
    const svc = new ThingService(repo);
    const saved = await svc.upsert('z', { name: 'new' });
    expect(saved).toEqual({ id: 'z', name: 'new' });
  });
});
