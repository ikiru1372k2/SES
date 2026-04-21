import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { FileVersionsService } from '../src/file-versions.service';

const user = {
  id: 'user-1',
  displayCode: 'USR-1',
  email: 'auditor@example.com',
  displayName: 'Auditor',
  role: 'auditor' as const,
};

describe('FileVersionsService', () => {
  it('rejects non-positive version downloads before repository access', async () => {
    const service = new FileVersionsService(
      {
        getVersionDownload: async () => {
          throw new Error('should not be called');
        },
      } as never,
      {
        whereProcessReadableBy: () => ({ members: { some: { userId: user.id } } }),
        assertCanAccessProcess: async () => undefined,
      } as never,
      {} as never,
      { append: async () => undefined } as never,
    );

    await assert.rejects(
      () => service.download('FIL-1', 0, user),
      (err) => err instanceof BadRequestException,
    );
  });

  it('creates a file version by snapshotting the current blob', async () => {
    let snapshotted = false;
    const service = new FileVersionsService(
      {
        findFileWithSheets: async () => ({ processId: 'process-1' }),
        snapshotCurrentVersion: async (_file: string, _user: typeof user, note: string) => {
          snapshotted = note === 'manager approved';
          return { id: 'fv-1', fileId: 'file-1', versionNumber: 2, note: 'manager approved' };
        },
      } as never,
      {
        whereProcessReadableBy: () => ({ members: { some: { userId: user.id } } }),
        require: async () => undefined,
      } as never,
      {} as never,
      { append: async () => undefined } as never,
    );

    const result = await service.create('FIL-1', { note: 'manager approved' }, user);

    assert.equal(result.versionNumber, 2);
    assert.equal(snapshotted, true);
  });
});
