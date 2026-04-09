import fs from "node:fs";
import path from "node:path";
import { SETTINGS } from "./config.js";
import { ensureDir, slugify } from "./utils.js";

export interface StoredFileRecord {
  id: string;
  originalFileName: string;
  storedPath: string;
  uploadedAt: string;
  detectedSheets: Array<{
    name: string;
    auditable: boolean;
    duplicate: boolean;
    rowCount: number;
    reason?: string;
  }>;
}

export interface NotificationTemplateSettings {
  greeting: string;
  intro: string;
  actionLine: string;
  deadlineText: string;
  closing: string;
  signatureLine1: string;
  signatureLine2: string;
}

export interface NotificationTrackingRecord {
  key: string;
  recipientEmail: string;
  projectManager: string;
  outlookCount: number;
  teamsCount: number;
  lastChannel?: "outlook" | "teams";
  lastStage?: "reminder1" | "reminder2" | "teamsEscalation";
  lastSentAt?: string;
  history: Array<{
    channel: "outlook" | "teams";
    stage: "reminder1" | "reminder2" | "teamsEscalation";
    sentAt: string;
  }>;
}

export interface StoredProcess {
  id: string;
  name: string;
  description: string;
  sourceType: "currentWorkbook" | "uploadedFile";
  workbookName?: string;
  detectedSheets: Array<{
    name: string;
    auditable: boolean;
    duplicate: boolean;
    rowCount: number;
    reason?: string;
  }>;
  sheetScope: "all" | "selected";
  selectedSheetNames: string[];
  files: StoredFileRecord[];
  activeFileId?: string;
  latestAuditStatus?: {
    flaggedRows: number;
    issueCount: number;
    updatedAt: string;
  };
  notificationTemplate: NotificationTemplateSettings;
  notificationTracking: Record<string, NotificationTrackingRecord>;
  createdAt: string;
  updatedAt: string;
}

interface ProcessIndex {
  processes: StoredProcess[];
}

function normalizeProcess(process: Partial<StoredProcess>): StoredProcess {
  const now = new Date().toISOString();
  const notificationTemplate: NotificationTemplateSettings = {
    greeting: process.notificationTemplate?.greeting ?? "Hi {{projectManager}},",
    intro: process.notificationTemplate?.intro ?? "As part of the ongoing effort audit, we identified discrepancies in the project effort data listed below.",
    actionLine: process.notificationTemplate?.actionLine ?? "Please review the below records and update the project data in the relevant tracking system.",
    deadlineText: process.notificationTemplate?.deadlineText ?? "Please complete the update by {{deadline}}.",
    closing: process.notificationTemplate?.closing ?? "If any item is already correct, please reply with the justification so the QGC team can review and close it.",
    signatureLine1: process.notificationTemplate?.signatureLine1 ?? "QGC Team",
    signatureLine2: process.notificationTemplate?.signatureLine2 ?? "MSG Global Solutions",
  };
  return {
    id: process.id ?? `${slugify(process.name || "audit-workspace")}-${Date.now()}`,
    name: process.name ?? "Audit Workspace",
    description: process.description ?? "",
    sourceType: process.sourceType === "uploadedFile" ? "uploadedFile" : "currentWorkbook",
    workbookName: process.workbookName,
    detectedSheets: Array.isArray(process.detectedSheets) ? process.detectedSheets : [],
    sheetScope: process.sheetScope === "selected" ? "selected" : "all",
    selectedSheetNames: Array.isArray(process.selectedSheetNames) ? process.selectedSheetNames : [],
    files: Array.isArray(process.files) ? process.files : [],
    activeFileId: process.activeFileId,
    latestAuditStatus: process.latestAuditStatus,
    notificationTemplate,
    notificationTracking: process.notificationTracking && typeof process.notificationTracking === "object" ? process.notificationTracking : {},
    createdAt: process.createdAt ?? now,
    updatedAt: process.updatedAt ?? process.createdAt ?? now,
  };
}

function readStore(): ProcessIndex {
  ensureDir(path.dirname(SETTINGS.processStoreFile));
  if (!fs.existsSync(SETTINGS.processStoreFile)) {
    return { processes: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(SETTINGS.processStoreFile, "utf8")) as ProcessIndex;
  return {
    processes: Array.isArray(parsed.processes) ? parsed.processes.map(normalizeProcess) : [],
  };
}

function writeStore(store: ProcessIndex): void {
  ensureDir(path.dirname(SETTINGS.processStoreFile));
  fs.writeFileSync(SETTINGS.processStoreFile, JSON.stringify(store, null, 2), "utf8");
}

export function listProcesses(): StoredProcess[] {
  return readStore().processes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getProcess(id: string): StoredProcess | undefined {
  return readStore().processes.find((process) => process.id === id);
}

export function createProcess(input: {
  name: string;
  description?: string;
  sourceType: "currentWorkbook" | "uploadedFile";
}): StoredProcess {
  const store = readStore();
  const now = new Date().toISOString();
  const process = normalizeProcess({
    id: `${slugify(input.name || "audit-workspace")}-${Date.now()}`,
    name: input.name,
    description: input.description ?? "",
    sourceType: input.sourceType,
    createdAt: now,
    updatedAt: now,
  });
  store.processes.unshift(process);
  writeStore(store);
  return process;
}

export function updateProcess(
  id: string,
  updates: Partial<Omit<StoredProcess, "id" | "createdAt">>,
): StoredProcess {
  const store = readStore();
  const index = store.processes.findIndex((process) => process.id === id);
  if (index < 0) {
    throw new Error("Process not found.");
  }

  const merged = { ...store.processes[index] } as Partial<StoredProcess>;
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      merged[key as keyof StoredProcess] = value as never;
    }
  }
  merged.updatedAt = new Date().toISOString();
  const updated = normalizeProcess(merged);
  store.processes[index] = updated;
  writeStore(store);
  return updated;
}

export function deleteProcess(id: string): void {
  const store = readStore();
  const nextProcesses = store.processes.filter((process) => process.id !== id);
  if (nextProcesses.length === store.processes.length) {
    throw new Error("Process not found.");
  }
  writeStore({ processes: nextProcesses });
}
