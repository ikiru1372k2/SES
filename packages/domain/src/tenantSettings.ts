export function tenantManagerDirectoryEnabled(settings: unknown): boolean {
  if (settings == null) return true;
  if (typeof settings !== 'object') return true;
  const o = settings as Record<string, unknown>;
  if (!('managerDirectory' in o)) return true;
  return Boolean(o.managerDirectory);
}
