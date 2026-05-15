import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { resolveIssueEmailsFromDirectory } from './resolve-issue-emails';

type DirectoryRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  normalizedKey: string;
  aliases: string[];
  active: boolean;
};

function fakeTx(entries: DirectoryRow[]) {
  return {
    managerDirectory: {
      findMany: async () => entries,
    },
  } as never;
}

describe('resolveIssueEmailsFromDirectory exact-key lookup', () => {
  it('resolves "Last, First" via exact normalized key before fuzzy', async () => {
    const entries: DirectoryRow[] = [
      {
        id: 'e1',
        email: 'jane@x.com',
        firstName: 'Jane',
        lastName: 'Doe',
        normalizedKey: 'doe jane',
        aliases: [],
        active: true,
      },
    ];
    const issues = [{ projectManager: 'Doe, Jane', email: undefined as string | undefined }];
    const out = await resolveIssueEmailsFromDirectory(fakeTx(entries), 't1', issues);
    assert.equal(out.resolvedFromDirectory, 1);
    assert.equal(out.issues[0]!.email, 'jane@x.com');
    assert.deepEqual(out.unresolvedManagerNames, []);
  });

  it('resolves case/spacing variants deterministically', async () => {
    const entries: DirectoryRow[] = [
      {
        id: 'e1',
        email: 'jane@x.com',
        firstName: 'Jane',
        lastName: 'Doe',
        normalizedKey: 'doe jane',
        aliases: [],
        active: true,
      },
    ];
    const issues = [{ projectManager: '  JANE   doe ', email: undefined as string | undefined }];
    const out = await resolveIssueEmailsFromDirectory(fakeTx(entries), 't1', issues);
    assert.equal(out.resolvedFromDirectory, 1);
    assert.equal(out.issues[0]!.email, 'jane@x.com');
  });

  it('defers to fuzzy matcher when exact key is ambiguous', async () => {
    // Two active entries with the same normalizedKey → ambiguous exact
    // hit. The exact path abstains and the fuzzy matcher flags a
    // collision, leaving the issue unresolved.
    const entries: DirectoryRow[] = [
      {
        id: 'e1',
        email: 'a@x.com',
        firstName: 'John',
        lastName: 'Smith',
        normalizedKey: 'john smith',
        aliases: [],
        active: true,
      },
      {
        id: 'e2',
        email: 'b@x.com',
        firstName: 'John',
        lastName: 'Smith',
        normalizedKey: 'john smith',
        aliases: [],
        active: true,
      },
    ];
    const issues = [{ projectManager: 'John Smith', email: undefined as string | undefined }];
    const out = await resolveIssueEmailsFromDirectory(fakeTx(entries), 't1', issues);
    assert.equal(out.resolvedFromDirectory, 0);
    assert.deepEqual(out.unresolvedManagerNames, ['John Smith']);
  });
});
