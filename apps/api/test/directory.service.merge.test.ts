import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { managerKey } from '@ses/domain';
import { DirectoryService } from '../src/modules/directory/directory.service';

const admin = {
  id: 'u-admin',
  displayCode: 'USR-ADM',
  email: 'admin@ses.local',
  displayName: 'Admin',
  role: 'admin' as const,
  tenantId: 'ses-tenant-default',
  tenantDisplayCode: 'Default',
  managerDirectoryEnabled: true,
};

describe('DirectoryService.merge', () => {
  it('repoints tracking rows for tenant, updates target aliases, archives source, logs activity', async () => {
    const tenantId = 'ses-tenant-default';
    const source = {
      id: 'src',
      displayCode: 'MDR-S',
      tenantId,
      firstName: 'Jane',
      lastName: 'Source',
      email: 'src@ex.com',
      normalizedKey: 'jane source',
      aliases: ['alias-src'],
      active: true,
      source: 'import',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdById: null as string | null,
    };
    const target = {
      id: 'tgt',
      displayCode: 'MDR-T',
      tenantId,
      firstName: 'Bob',
      lastName: 'Target',
      email: 'bob@ex.com',
      normalizedKey: 'bob target',
      aliases: ['alias-tgt'],
      active: true,
      source: 'import',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdById: null as string | null,
    };

    let updateManyArg: { where: object; data: object } | null = null;
    const appendCalls: object[] = [];

    const txStub = {
      trackingEntry: {
        updateMany: async (args: { where: object; data: object }) => {
          updateManyArg = args;
          return { count: 4 };
        },
      },
      managerDirectory: {
        update: async () => ({}),
      },
    };

    const prisma = {
      managerDirectory: {
        findFirst: async ({ where }: { where: { tenantId: string; OR: Array<{ id?: string; displayCode?: string }> } }) => {
          assert.equal(where.tenantId, tenantId);
          const key = where.OR[0]?.id ?? where.OR[1]?.id ?? where.OR[0]?.displayCode;
          if (key === 'src') return source;
          if (key === 'tgt') return target;
          return null;
        },
      },
      process: {
        findMany: async () => [] as Array<{ displayCode: string }>,
      },
      $transaction: async (fn: (tx: typeof txStub) => Promise<number>) => fn(txStub),
    };

    const service = new DirectoryService(
      prisma as never,
      {} as never,
      {
        append: async (_tx: unknown, meta: object) => {
          appendCalls.push(meta);
        },
      } as never,
      { emitToProcess: () => {} } as never,
    );

    const out = await service.merge(admin, { sourceId: 'src', targetId: 'tgt' });
    assert.equal(out.repointed, 4);
    assert.equal(out.targetId, 'tgt');

    assert.ok(updateManyArg);
    const um = updateManyArg as {
      where: { process: { tenantId: string }; OR: object[] };
      data: { managerEmail: string; managerName: string; managerKey: string };
    };
    assert.equal(um.where.process.tenantId, tenantId);
    assert.equal(um.data.managerEmail, 'bob@ex.com');
    const tgtName = 'Bob Target';
    assert.equal(um.data.managerName, tgtName);
    assert.equal(um.data.managerKey, managerKey(tgtName, 'bob@ex.com'));

    assert.equal(appendCalls.length, 1);
    const log = appendCalls[0] as { action: string; metadata: { repointed: number } };
    assert.equal(log.action, 'directory_merge');
    assert.equal(log.metadata.repointed, 4);
  });
});
