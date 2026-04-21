import { describe, expect, test, vi } from 'vitest';
import { saveFileDraftOnApi } from '../src/lib/api/fileDraftsApi';

describe('saveFileDraftOnApi beacon', () => {
  test('uses navigator.sendBeacon when beacon option is set and sendBeacon succeeds', async () => {
    const sendBeacon = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);
    const file = new File(['x'], 'book.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const result = await saveFileDraftOnApi('PRC-1', 'master-data', file, 'book.xlsx', { beacon: true });
    expect(result).toEqual({ ok: true });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url] = sendBeacon.mock.calls[0] as [string, FormData];
    expect(url).toContain('/draft/beacon');
    sendBeacon.mockRestore();
  });

  test('uses fetch when navigator.sendBeacon is not available', async () => {
    const original = navigator.sendBeacon;
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ fileName: 'book.xlsx', updatedAt: '2026-04-21T12:00:00.000Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const file = new File(['x'], 'book.xlsx');
    const meta = await saveFileDraftOnApi('PRC-1', 'master-data', file, 'book.xlsx', { beacon: true });
    expect(meta).toMatchObject({ fileName: 'book.xlsx' });
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('draft/beacon'));
    expect(call?.[1]).toMatchObject({ method: 'POST' });
    Object.defineProperty(navigator, 'sendBeacon', { value: original, configurable: true });
  });
});
