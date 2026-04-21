import { del, get, set } from 'idb-keyval';

const rawDataKey = (fileId: string) => `ses:workbook-raw:${fileId}`;

export async function putWorkbookRawData(fileId: string, rawData: Record<string, unknown[][]>): Promise<void> {
  await set(rawDataKey(fileId), rawData);
}

export async function getWorkbookRawData(fileId: string): Promise<Record<string, unknown[][]> | null> {
  return (await get<Record<string, unknown[][]>>(rawDataKey(fileId))) ?? null;
}

export async function deleteWorkbookRawData(fileId: string): Promise<void> {
  await del(rawDataKey(fileId));
}

/**
 * Move a cached rawData entry from one id to another. Used immediately after
 * a server upload completes — we cache under the parser-generated temp id
 * pre-response and then rekey to the server id so later reads hit it.
 *
 * Silently no-ops when the source key doesn't exist (idempotent).
 */
export async function renameWorkbookRawDataKey(fromId: string, toId: string): Promise<void> {
  if (fromId === toId) return;
  const data = await getWorkbookRawData(fromId);
  if (!data) return;
  await putWorkbookRawData(toId, data);
  await deleteWorkbookRawData(fromId);
}
