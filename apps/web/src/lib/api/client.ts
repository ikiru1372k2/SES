export const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export async function parseApiError(res: Response, fallback: string): Promise<Error> {
  const err = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(err.message ?? `${fallback} (${res.status})`);
}
