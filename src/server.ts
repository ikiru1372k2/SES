import express from "express";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { SETTINGS } from "./config.js";
import { compareSnapshotToRows, compareSnapshots, deleteSnapshots, listSnapshots } from "./snapshots.js";
import { runAudit } from "./pipeline.js";
import { buildSessionId, getNextVersion, saveSnapshot } from "./snapshots.js";
import { deleteSession, readSessionIndex, upsertSession } from "./sessionStore.js";
import { deletePreviewFiles, writePreviewFiles } from "./preview.js";
import { deleteOutlookDrafts, openOutlookDraftFile, writeOutlookDraft } from "./outlookDrafts.js";
import { createProcess, deleteProcess, getProcess, listProcesses, updateProcess } from "./processStore.js";
import { ensureDir, slugify } from "./utils.js";
import { auditRows } from "./audit.js";
import { buildNotificationDrafts } from "./notifications.js";
import { inspectWorkbook, loadWorkbookFromBuffer, normalizeRows } from "./workbook.js";

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.resolve("public")));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/audit/run", async (request, response) => {
  try {
    const workbookPath = String(request.body?.workbookPath ?? "effort_sample_data.xlsx");
    const sessionId = request.body?.sessionId ? String(request.body.sessionId) : undefined;
    const result = await runAudit(workbookPath, sessionId);
    response.json({
      sessionId: result.sessionId,
      version: result.snapshot.version,
      scannedSheets: result.snapshot.scannedSheetNames,
      summary: result.snapshot.summary,
      previewFiles: result.previewFiles,
      auditedWorkbookPath: result.auditedWorkbookPath,
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/audit/:sessionId", (request, response) => {
  const snapshots = listSnapshots(request.params.sessionId);
  if (snapshots.length === 0) {
    response.status(404).json({ error: "Session not found" });
    return;
  }
  response.json({
    sessionId: request.params.sessionId,
    versions: snapshots.map((snapshot) => ({
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      summary: snapshot.summary,
    })),
  });
});

app.get("/audit/:sessionId/version/:version", (request, response) => {
  const version = Number(request.params.version);
  const snapshot = listSnapshots(request.params.sessionId).find((item) => item.version === version);
  if (!snapshot) {
    response.status(404).json({ error: "Snapshot not found" });
    return;
  }
  response.json(snapshot);
});

app.get("/audit/:sessionId/compare", (request, response) => {
  const fromVersion = Number(request.query.from);
  const toVersion = Number(request.query.to);
  const snapshots = listSnapshots(request.params.sessionId);
  const fromSnapshot = snapshots.find((snapshot) => snapshot.version === fromVersion);
  const toSnapshot = snapshots.find((snapshot) => snapshot.version === toVersion);
  if (!fromSnapshot || !toSnapshot) {
    response.status(404).json({ error: "Requested versions were not found" });
    return;
  }
  response.json(compareSnapshots(fromSnapshot, toSnapshot));
});

app.post("/audit/:sessionId/compare-current", (request, response) => {
  const snapshots = listSnapshots(request.params.sessionId);
  const latestSnapshot = snapshots[snapshots.length - 1];
  if (!latestSnapshot) {
    response.status(404).json({ error: "No baseline snapshot found" });
    return;
  }
  const currentRows = Array.isArray(request.body?.rows) ? request.body.rows : [];
  response.json(compareSnapshotToRows(latestSnapshot, currentRows));
});

app.get("/audit/:sessionId/preview/:fileName", (request, response) => {
  const filePath = path.resolve(SETTINGS.previewDir, request.params.fileName);
  if (!fs.existsSync(filePath)) {
    response.status(404).send("Preview not found");
    return;
  }
  response.type("html").send(fs.readFileSync(filePath, "utf8"));
});

app.get("/drafts/:fileName", (request, response) => {
  const filePath = path.resolve(SETTINGS.draftDir, request.params.fileName);
  if (!fs.existsSync(filePath)) {
    response.status(404).send("Draft not found");
    return;
  }
  response.type("message/rfc822").send(fs.readFileSync(filePath, "utf8"));
});

app.post("/api/addin/snapshot", (request, response) => {
  try {
    const workbookName = String(request.body?.workbookName ?? "excel-workbook");
    const sessionId = request.body?.sessionId ? String(request.body.sessionId) : buildSessionId(workbookName);
    const version = getNextVersion(sessionId);
    const snapshot = {
      sessionId,
      version,
      createdAt: new Date().toISOString(),
      workbookPath: workbookName,
      sourceSheetName: String(request.body?.sourceSheetName ?? ""),
      scannedSheetNames: Array.isArray(request.body?.scannedSheetNames) ? request.body.scannedSheetNames : [],
      duplicateSheetNames: Array.isArray(request.body?.duplicateSheetNames) ? request.body.duplicateSheetNames : [],
      summary: request.body?.summary,
      rows: Array.isArray(request.body?.rows) ? request.body.rows : [],
      notifications: Array.isArray(request.body?.notifications) ? request.body.notifications : [],
    };

    const previewFiles = writePreviewFiles(sessionId, snapshot.notifications);
    saveSnapshot(snapshot);
    upsertSession(snapshot, previewFiles[0] ?? "");

    response.json({
      sessionId,
      version,
      previewUrls: previewFiles.map((filePath) => {
        const fileName = path.basename(filePath);
        return `/audit/${sessionId}/preview/${fileName}`;
      }),
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/addin/sessions", (_request, response) => {
  const index = readSessionIndex();
  response.json(index);
});

app.get("/api/addin/session/:sessionId", (request, response) => {
  const snapshots = listSnapshots(request.params.sessionId);
  if (snapshots.length === 0) {
    response.status(404).json({ error: "Session not found" });
    return;
  }

  response.json({
    sessionId: request.params.sessionId,
    versions: snapshots.map((snapshot) => ({
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      summary: snapshot.summary,
    })),
  });
});

app.post("/api/addin/outlook-draft", (request, response) => {
  try {
    const processId = String(request.body?.processId ?? "audit-process");
    const recipientEmail = String(request.body?.recipientEmail ?? "");
    const subject = String(request.body?.subject ?? "Effort Audit Reminder");
    const html = String(request.body?.html ?? "");
    const text = String(request.body?.text ?? "");
    if (!recipientEmail || !html) {
      throw new Error("Recipient email and HTML draft content are required.");
    }
    const filePath = writeOutlookDraft(processId, recipientEmail, subject, html, text);
    openOutlookDraftFile(filePath);
    response.json({
      draftUrl: `/drafts/${path.basename(filePath)}`,
      opened: true,
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/addin/processes", (_request, response) => {
  response.json({ processes: listProcesses() });
});

app.post("/api/addin/processes", (request, response) => {
  try {
    const process = createProcess({
      name: String(request.body?.name ?? "Audit Workspace"),
      description: String(request.body?.description ?? ""),
      sourceType: request.body?.sourceType === "uploadedFile" ? "uploadedFile" : "currentWorkbook",
    });
    response.json(process);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/addin/processes/:id", (request, response) => {
  const process = getProcess(request.params.id);
  if (!process) {
    response.status(404).json({ error: "Process not found" });
    return;
  }
  response.json(process);
});

app.patch("/api/addin/processes/:id", (request, response) => {
  try {
    const process = updateProcess(request.params.id, {
      name: request.body?.name,
      description: request.body?.description,
      workbookName: request.body?.workbookName,
      detectedSheets: Array.isArray(request.body?.detectedSheets) ? request.body.detectedSheets : undefined,
      sheetScope: request.body?.sheetScope === "selected" ? "selected" : request.body?.sheetScope === "all" ? "all" : undefined,
      selectedSheetNames: Array.isArray(request.body?.selectedSheetNames) ? request.body.selectedSheetNames : undefined,
      activeFileId: request.body?.activeFileId,
      latestAuditStatus: request.body?.latestAuditStatus,
      notificationTemplate: request.body?.notificationTemplate,
      notificationTracking: request.body?.notificationTracking,
    });
    response.json(process);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/addin/processes/:id", (request, response) => {
  try {
    const process = getProcess(request.params.id);
    if (!process) {
      response.status(404).json({ error: "Process not found" });
      return;
    }

    for (const file of process.files) {
      if (fs.existsSync(file.storedPath)) {
        fs.unlinkSync(file.storedPath);
      }
    }

    deleteSnapshots(process.id);
    deletePreviewFiles(process.id);
    deleteOutlookDrafts(process.id);
    deleteSession(process.id);
    deleteProcess(process.id);

    response.json({ ok: true, deletedProcessId: process.id });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/addin/processes/:id/upload", async (request, response) => {
  try {
    const process = getProcess(request.params.id);
    if (!process) {
      response.status(404).json({ error: "Process not found" });
      return;
    }

    const fileName = String(request.body?.fileName ?? "uploaded-workbook.xlsx");
    const contentBase64 = String(request.body?.contentBase64 ?? "");
    if (!contentBase64) {
      throw new Error("Uploaded file content is missing.");
    }

    const buffer = Buffer.from(contentBase64, "base64");
    const workbook = await loadWorkbookFromBuffer(buffer);
    const detectedSheets = inspectWorkbook(workbook);

    ensureDir(SETTINGS.uploadDir);
    const filePath = path.resolve(
      SETTINGS.uploadDir,
      `${process.id}-${Date.now()}-${slugify(path.basename(fileName, path.extname(fileName)) || "workbook")}${path.extname(fileName) || ".xlsx"}`,
    );
    fs.writeFileSync(filePath, buffer);

    const fileRecord = {
      id: `${process.id}-file-${Date.now()}`,
      originalFileName: fileName,
      storedPath: filePath,
      uploadedAt: new Date().toISOString(),
      detectedSheets,
    };

    const updated = updateProcess(process.id, {
      workbookName: fileName,
      detectedSheets,
      files: [...process.files, fileRecord],
      activeFileId: fileRecord.id,
      sheetScope: "all",
      selectedSheetNames: detectedSheets.filter((sheet) => sheet.auditable && !sheet.duplicate).map((sheet) => sheet.name),
    });

    response.json(updated);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/addin/processes/:id/analyze", async (request, response) => {
  try {
    const process = getProcess(request.params.id);
    const activeFile = process?.files.find((file) => file.id === (request.body?.activeFileId ?? process?.activeFileId));
    if (!process || process.sourceType !== "uploadedFile" || !activeFile) {
      response.status(404).json({ error: "Uploaded-file process not found" });
      return;
    }

    const workbook = await loadWorkbookFromBuffer(fs.readFileSync(activeFile.storedPath));
    const selectedSheetNames = Array.isArray(request.body?.selectedSheetNames) && request.body.selectedSheetNames.length > 0
      ? request.body.selectedSheetNames
      : process.selectedSheetNames;

    const auditableSelectedSheets = process.detectedSheets
      .filter((sheet) => selectedSheetNames.includes(sheet.name) && sheet.auditable && !sheet.duplicate)
      .map((sheet) => sheet.name);

    const rows = normalizeRows(workbook, {
      sourceSheetName: auditableSelectedSheets[0] ?? "",
      scannedSheetNames: auditableSelectedSheets,
      duplicateSheetNames: process.detectedSheets.filter((sheet) => sheet.duplicate).map((sheet) => sheet.name),
      headerRow: SETTINGS.headerRow,
      firstDataRow: SETTINGS.firstDataRow,
    });
    const audited = auditRows(rows);
    const notifications = buildNotificationDrafts(audited.rows, audited.summary);

    response.json({
      rows: audited.rows,
      summary: audited.summary,
      notifications,
      scannedSheets: auditableSelectedSheets,
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/", (_request, response) => {
  response.redirect("/taskpane.html");
});

const certPfxPath = path.resolve("certs", "localhost.pfx");
const certPassphrase = process.env.DEV_CERT_PASSPHRASE ?? "office-addin-dev";

if (fs.existsSync(certPfxPath)) {
  const server = https.createServer(
    {
      pfx: fs.readFileSync(certPfxPath),
      passphrase: certPassphrase,
    },
    app,
  );

  server.listen(SETTINGS.defaultPort, () => {
    console.log(`Effort workbook auditor server running at https://localhost:${SETTINGS.defaultPort}`);
  });
} else {
  const server = http.createServer(app);
  server.listen(SETTINGS.defaultPort, () => {
    console.log(`Effort workbook auditor server running at http://localhost:${SETTINGS.defaultPort}`);
    console.log("HTTPS certificate not found. Create certs/localhost.pfx for Excel sideloading.");
  });
}
