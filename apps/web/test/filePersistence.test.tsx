import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { DraftRestoreBanner } from '../src/components/workspace/DraftRestoreBanner';
import { downloadFileFromApi } from '../src/lib/api/filesApi';
import { listFileVersionsOnApi } from '../src/lib/api/fileVersionsApi';

test('draft restore banner appears only when the draft is newer than current file', () => {
  const restore = vi.fn(() => Promise.resolve());
  const discard = vi.fn(() => Promise.resolve());

  const { rerender } = render(
    <DraftRestoreBanner
      draft={{
        fileName: 'draft.xlsx',
        updatedAt: '2026-04-21T12:00:00.000Z',
      }}
      currentFile={{
        id: 'file-1',
        name: 'current.xlsx',
        uploadedAt: '2026-04-21T12:05:00.000Z',
        lastAuditedAt: null,
        isAudited: false,
        sheets: [],
        rawData: {},
      }}
      processId="process-1"
      functionId="master-data"
      onRestore={restore}
      onDiscard={discard}
    />,
  );

  expect(screen.queryByText(/Unsaved draft available/)).toBeNull();

  rerender(
    <DraftRestoreBanner
      draft={{
        fileName: 'draft.xlsx',
        updatedAt: '2026-04-21T12:10:00.000Z',
      }}
      currentFile={{
        id: 'file-1',
        name: 'current.xlsx',
        uploadedAt: '2026-04-21T12:05:00.000Z',
        lastAuditedAt: null,
        isAudited: false,
        sheets: [],
        rawData: {},
      }}
      processId="process-1"
      functionId="master-data"
      onRestore={restore}
      onDiscard={discard}
    />,
  );

  expect(screen.getByText(/Unsaved draft available/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  expect(restore).toHaveBeenCalledWith('process-1', 'master-data');
});

test('file download includes optional version query', async () => {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockResolvedValueOnce(new Response(new Blob(['x']), { status: 200 }));

  await downloadFileFromApi('FIL-1', 3);

  expect(fetchMock).toHaveBeenCalledWith('/api/v1/files/FIL-1/download?version=3', {
    credentials: 'include',
  });
});

test('file versions API reads metadata without bytes', async () => {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
    {
      id: 'fv-1',
      fileId: 'file-1',
      versionNumber: 1,
      note: 'Initial',
      sizeBytes: 10,
      createdAt: '2026-04-21T12:00:00.000Z',
      isCurrent: true,
    },
  ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  const versions = await listFileVersionsOnApi('FIL-1');

  expect(versions[0]?.versionNumber).toBe(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/files/FIL-1/versions', {
    credentials: 'include',
  });
});
