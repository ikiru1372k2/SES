import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import { ConfirmProvider } from '../../shared/ConfirmProvider';
import { DirectoryTable } from '../DirectoryTable';
import * as directoryApi from '../../../lib/api/directoryApi';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('../../../lib/api/directoryApi', () => ({
  directoryList: vi.fn(),
  directoryPatch: vi.fn(),
  directoryArchiveBulk: vi.fn(),
  directoryMerge: vi.fn(),
  directoryMergeImpact: vi.fn(),
  createManager: vi.fn(),
  deleteManager: vi.fn(),
  // AddManagerForm imports this for `instanceof` checks.
  DirectoryFieldError: class DirectoryFieldError extends Error {},
}));

type Entry = directoryApi.DirectoryEntry;

function mkEntry(over: Partial<Entry>): Entry {
  return {
    id: 'id',
    displayCode: 'MGR-X',
    firstName: 'First',
    lastName: 'Last',
    email: 'first@x.com',
    teamsUsername: null,
    normalizedKey: 'first last',
    aliases: [],
    active: true,
    source: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const rowA = mkEntry({ id: 'a', displayCode: 'MGR-A', firstName: 'Ann', lastName: 'Lee', email: 'ann@x.com' });
const rowB = mkEntry({ id: 'b', displayCode: 'MGR-B', firstName: 'Bob', lastName: 'Ng', email: 'bob@x.com' });

function row(code: string): HTMLElement {
  const cell = screen.getByText(code);
  const tr = cell.closest('tr');
  if (!tr) throw new Error(`row ${code} not found`);
  return tr as HTMLElement;
}

const dialog = () => screen.getByRole('dialog');

async function renderTable(items: Entry[] = [rowA, rowB]) {
  vi.mocked(directoryApi.directoryList).mockResolvedValue({
    items,
    total: items.length,
    limit: 100,
    offset: 0,
  });
  render(
    <ConfirmProvider>
      <DirectoryTable refreshKey={0} />
    </ConfirmProvider>,
  );
  await screen.findByText('MGR-A');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DirectoryTable inline edit', () => {
  it('removes the Active column (no Active header, no Inactive badge)', async () => {
    await renderTable();
    expect(screen.queryByRole('columnheader', { name: 'Active' })).toBeNull();
    expect(screen.queryByText('Inactive')).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeTruthy();
  });

  it('edits a row and saves only the changed fields', async () => {
    await renderTable();
    const updated = mkEntry({ ...rowA, firstName: 'Anne', email: 'anne@x.com' });
    vi.mocked(directoryApi.directoryPatch).mockResolvedValue(updated);

    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: /edit manager ann lee/i }));
    fireEvent.change(within(row('MGR-A')).getByLabelText('First name'), { target: { value: 'Anne' } });
    fireEvent.change(within(row('MGR-A')).getByLabelText('Email'), { target: { value: 'Anne@x.com' } });
    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(directoryApi.directoryPatch).toHaveBeenCalledWith('a', {
        firstName: 'Anne',
        email: 'anne@x.com',
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('Manager updated');
    expect(await screen.findByText('Anne Lee')).toBeTruthy();
    expect(within(row('MGR-A')).getByRole('button', { name: /edit manager/i })).toBeTruthy();
  });

  it('Cancel reverts without calling the API', async () => {
    await renderTable();
    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: /edit manager ann lee/i }));
    fireEvent.change(within(row('MGR-A')).getByLabelText('First name'), { target: { value: 'Zzz' } });
    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: 'Cancel' }));

    expect(directoryApi.directoryPatch).not.toHaveBeenCalled();
    expect(screen.getByText('Ann Lee')).toBeTruthy();
  });

  it('no-op save does not call the API and closes the editor', async () => {
    await renderTable();
    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: /edit manager ann lee/i }));
    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: 'Save' }));

    expect(directoryApi.directoryPatch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Ann Lee')).toBeTruthy());
  });

  it('email change goes through the confirmation flow', async () => {
    await renderTable();
    const updated = mkEntry({ ...rowA, email: 'ann2@x.com' });
    vi.mocked(directoryApi.directoryPatch)
      .mockResolvedValueOnce({ requiresConfirmation: true, trackingRowsToRepoint: 3, entry: updated })
      .mockResolvedValueOnce(updated);

    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: /edit manager ann lee/i }));
    fireEvent.change(within(row('MGR-A')).getByLabelText('Email'), { target: { value: 'ann2@x.com' } });
    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/repoint 3 tracking rows/i)).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: /update email/i }));

    await waitFor(() =>
      expect(directoryApi.directoryPatch).toHaveBeenLastCalledWith('a', {
        email: 'ann2@x.com',
        applyEmailChange: true,
      }),
    );
    expect(directoryApi.directoryPatch).toHaveBeenCalledTimes(2);
  });

  it('declining the email confirmation keeps the row in edit mode and makes one call', async () => {
    await renderTable();
    vi.mocked(directoryApi.directoryPatch).mockResolvedValueOnce({
      requiresConfirmation: true,
      trackingRowsToRepoint: 1,
      entry: rowA,
    });

    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: /edit manager ann lee/i }));
    fireEvent.change(within(row('MGR-A')).getByLabelText('Email'), { target: { value: 'nope@x.com' } });
    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/repoint 1 tracking row\b/i)).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => expect(directoryApi.directoryPatch).toHaveBeenCalledTimes(1));
    expect(within(row('MGR-A')).getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('toggling Active off under the active filter drops the row from the list', async () => {
    await renderTable();
    const updated = mkEntry({ ...rowA, active: false });
    vi.mocked(directoryApi.directoryPatch).mockResolvedValue(updated);

    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: /edit manager ann lee/i }));
    fireEvent.click(within(row('MGR-A')).getByLabelText('Active'));
    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByText('MGR-A')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith(
      'Manager updated (no longer visible under current filter).',
    );
  });

  it('only one row is editable at a time', async () => {
    await renderTable();
    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: /edit manager ann lee/i }));

    expect(within(row('MGR-B')).getByRole('button', { name: /edit manager bob ng/i })).toBeDisabled();
    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: 'Cancel' }));
    expect(
      within(row('MGR-B')).getByRole('button', { name: /edit manager bob ng/i }),
    ).not.toBeDisabled();
  });

  it('surfaces an API error and keeps the row editable', async () => {
    await renderTable();
    vi.mocked(directoryApi.directoryPatch).mockRejectedValue(new Error('Email already in use'));

    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: /edit manager ann lee/i }));
    fireEvent.change(within(row('MGR-A')).getByLabelText('Email'), { target: { value: 'dup@x.com' } });
    fireEvent.click(within(row('MGR-A')).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Email already in use'));
    expect(within(row('MGR-A')).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(row('MGR-A')).getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});
