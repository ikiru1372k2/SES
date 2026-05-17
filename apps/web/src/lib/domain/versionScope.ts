import { DEFAULT_FUNCTION_ID } from '@ses/domain';
import type { AuditProcess, AuditResult, AuditVersion } from './types';

/**
 * The function a saved version belongs to. Prefer the explicit functionId
 * (set by the server and by new saves); fall back to the audited file's
 * function so pre-existing / optimistic versions still bucket correctly.
 *
 * This is the single source of truth shared by the save path
 * (useAppStore.saveVersion / saveOverCurrentVersion) and every version
 * display surface, so numbering and display can never drift apart.
 */
export function versionFunctionId(
  process: AuditProcess,
  result: AuditResult,
  explicit?: string,
): string {
  if (explicit) return explicit;
  const file = process.files.find((f) => f.id === result.fileId);
  return file?.functionId ?? DEFAULT_FUNCTION_ID;
}

/**
 * Versions belonging to one function, preserving `process.versions` order
 * (newest-first), so index 0 is that function's head. Versioning is
 * independent per function: saving function A must never change function B's
 * head / next number / pills.
 */
export function selectFunctionVersions(
  process: AuditProcess,
  functionId: string,
): AuditVersion[] {
  return process.versions.filter(
    (v) => versionFunctionId(process, v.result, v.functionId) === functionId,
  );
}
