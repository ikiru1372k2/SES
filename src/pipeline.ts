import path from "node:path";
import { buildNotificationDrafts } from "./notifications.js";
import { auditRows } from "./audit.js";
import { buildSessionId, getNextVersion, saveSnapshot } from "./snapshots.js";
import { upsertSession } from "./sessionStore.js";
import type { Snapshot } from "./types.js";
import { detectTemplate, loadWorkbook, normalizeRows } from "./workbook.js";
import { writePreviewFiles } from "./preview.js";
import { writeAuditWorkbook } from "./writer.js";

export interface AuditRunResult {
  sessionId: string;
  snapshot: Snapshot;
  auditedWorkbookPath: string;
  previewFiles: string[];
}

export async function runAudit(workbookPath: string, existingSessionId?: string): Promise<AuditRunResult> {
  const absoluteWorkbookPath = path.resolve(workbookPath);
  const workbook = await loadWorkbook(absoluteWorkbookPath);
  const template = detectTemplate(workbook);
  const normalizedRows = normalizeRows(workbook, template);
  const { rows, summary } = auditRows(normalizedRows);
  const drafts = buildNotificationDrafts(rows, summary);
  const sessionId = existingSessionId ?? buildSessionId(absoluteWorkbookPath);
  const version = getNextVersion(sessionId);
  const auditedWorkbookPath = await writeAuditWorkbook(workbook, rows);
  const previewFiles = writePreviewFiles(sessionId, drafts);

  const snapshot: Snapshot = {
    sessionId,
    version,
    createdAt: new Date().toISOString(),
    workbookPath: absoluteWorkbookPath,
    sourceSheetName: template.sourceSheetName,
    scannedSheetNames: template.scannedSheetNames,
    duplicateSheetNames: template.duplicateSheetNames,
    summary,
    rows,
    notifications: drafts,
  };

  saveSnapshot(snapshot);
  upsertSession(snapshot, previewFiles[0] ?? "");

  return {
    sessionId,
    snapshot,
    auditedWorkbookPath,
    previewFiles,
  };
}
