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
