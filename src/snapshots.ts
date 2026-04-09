import fs from "node:fs";
import path from "node:path";
import { SETTINGS } from "./config.js";
import type { AuditedRow, Snapshot, SnapshotComparison, SnapshotIssueDelta } from "./types.js";
import { ensureDir, slugify } from "./utils.js";

export function buildSessionId(workbookPath: string): string {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const base = path.basename(workbookPath, path.extname(workbookPath));
  return `${slugify(base)}-${stamp}`;
}

export function saveSnapshot(snapshot: Snapshot): string {
  ensureDir(SETTINGS.snapshotDir);
  const snapshotPath = path.resolve(SETTINGS.snapshotDir, `${snapshot.sessionId}.v${snapshot.version}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");
  return snapshotPath;
}

export function listSnapshots(sessionId?: string): Snapshot[] {
  ensureDir(SETTINGS.snapshotDir);
  return fs
    .readdirSync(SETTINGS.snapshotDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => path.resolve(SETTINGS.snapshotDir, fileName))
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as Snapshot)
    .filter((snapshot) => (sessionId ? snapshot.sessionId === sessionId : true))
    .sort((left, right) => left.version - right.version);
}

export function getNextVersion(sessionId: string): number {
  const snapshots = listSnapshots(sessionId);
  if (snapshots.length === 0) {
    return 1;
  }
  return snapshots[snapshots.length - 1].version + 1;
}

function rowIdentity(row: AuditedRow): string {
  return `${row.projectNo}||${row.projectManager}`;
}

function projectIdentity(row: AuditedRow): string {
  return row.projectNo;
}

function toIssueDelta(row: AuditedRow): SnapshotIssueDelta {
  return {
    projectNo: row.projectNo,
    project: row.project,
    projectManager: row.projectManager,
    email: row.email,
    sourceSheetName: row.sourceSheetName,
    auditStatus: row.auditStatus,
    auditSeverity: row.auditSeverity,
    issueCodes: row.issues.map((issue) => issue.code),
  };
}

function compareRowSets(fromSnapshot: Snapshot, toRows: AuditedRow[], toVersion: number | null): SnapshotComparison {
  const fromRows = fromSnapshot.rows;
  const fromMap = new Map(fromRows.map((row) => [rowIdentity(row), row]));
  const toMap = new Map(toRows.map((row) => [rowIdentity(row), row]));
  const fromProjectMap = new Map(fromRows.map((row) => [projectIdentity(row), row]));
  const toProjectMap = new Map(toRows.map((row) => [projectIdentity(row), row]));

  let newIssues = 0;
  let resolvedIssues = 0;
  const newIssueRows: SnapshotIssueDelta[] = [];
  const resolvedIssueRows: SnapshotIssueDelta[] = [];
  const severityChanges: SnapshotComparison["severityChanges"] = [];
  const managerChanges: SnapshotComparison["managerChanges"] = [];
  const managerChangedProjects = new Set<string>();

  for (const [projectNo, toRow] of toProjectMap.entries()) {
    const fromRow = fromProjectMap.get(projectNo);
    if (fromRow && fromRow.projectManager !== toRow.projectManager) {
      managerChanges.push({
        projectNo,
        project: toRow.project,
        fromManager: fromRow.projectManager,
        toManager: toRow.projectManager,
      });
      managerChangedProjects.add(projectNo);
    }
  }

  for (const [key, toRow] of toMap.entries()) {
    const fromRow = fromMap.get(key);
    if (!fromRow) {
      if (toRow.issues.length > 0) {
        newIssues += toRow.issues.length;
        newIssueRows.push(toIssueDelta(toRow));
      }
      continue;
    }

    if (fromRow.auditSeverity !== toRow.auditSeverity) {
      severityChanges.push({
        projectNo: toRow.projectNo,
        project: toRow.project,
        projectManager: toRow.projectManager,
        from: fromRow.auditSeverity,
        to: toRow.auditSeverity,
      });
    }

    const fromIssueKeys = new Set(fromRow.issues.map((issue) => issue.code));
    const toIssueKeys = new Set(toRow.issues.map((issue) => issue.code));

    for (const issueKey of toIssueKeys) {
      if (!fromIssueKeys.has(issueKey)) {
        newIssues += 1;
      }
    }
    if ([...toIssueKeys].some((issueKey) => !fromIssueKeys.has(issueKey))) {
      newIssueRows.push(toIssueDelta(toRow));
    }

    for (const issueKey of fromIssueKeys) {
      if (!toIssueKeys.has(issueKey)) {
        resolvedIssues += 1;
      }
    }
    if ([...fromIssueKeys].some((issueKey) => !toIssueKeys.has(issueKey))) {
      resolvedIssueRows.push(toIssueDelta(toRow));
    }
  }

  for (const [key, fromRow] of fromMap.entries()) {
    if (!toMap.has(key)) {
      if (managerChangedProjects.has(fromRow.projectNo)) {
        continue;
      }
      resolvedIssues += fromRow.issues.length;
      if (fromRow.issues.length > 0) {
        resolvedIssueRows.push(toIssueDelta(fromRow));
      }
    }
  }

  return {
    fromVersion: fromSnapshot.version,
    toVersion,
    baselineVersion: fromSnapshot.version,
    baselineCreatedAt: fromSnapshot.createdAt,
    newIssues,
    resolvedIssues,
    newIssueRows,
    resolvedIssueRows,
    severityChanges,
    managerChanges,
  };
}

export function compareSnapshots(fromSnapshot: Snapshot, toSnapshot: Snapshot): SnapshotComparison {
  return compareRowSets(fromSnapshot, toSnapshot.rows, toSnapshot.version);
}

export function compareSnapshotToRows(fromSnapshot: Snapshot, currentRows: AuditedRow[]): SnapshotComparison {
  return compareRowSets(fromSnapshot, currentRows, null);
}

export function deleteSnapshots(sessionId: string): void {
  ensureDir(SETTINGS.snapshotDir);
  for (const fileName of fs.readdirSync(SETTINGS.snapshotDir)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const filePath = path.resolve(SETTINGS.snapshotDir, fileName);
    const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8")) as Snapshot;
    if (snapshot.sessionId === sessionId && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
