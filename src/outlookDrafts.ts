import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { SETTINGS } from "./config.js";
import { ensureDir, slugify } from "./utils.js";

function escapeHeader(value: string): string {
  return value.replaceAll(/\r?\n/g, " ").trim();
}

function buildEml(recipientEmail: string, subject: string, html: string, text: string): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return [
    "MIME-Version: 1.0",
    `To: ${escapeHeader(recipientEmail)}`,
    `Subject: ${escapeHeader(subject)}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export function writeOutlookDraft(processId: string, recipientEmail: string, subject: string, html: string, text: string): string {
  ensureDir(SETTINGS.draftDir);
  const fileName = `${processId}-${Date.now()}-${slugify(recipientEmail || "draft")}.eml`;
  const filePath = path.resolve(SETTINGS.draftDir, fileName);
  fs.writeFileSync(filePath, buildEml(recipientEmail, subject, html, text), "utf8");
  return filePath;
}

export function deleteOutlookDrafts(processId: string): void {
  ensureDir(SETTINGS.draftDir);
  for (const fileName of fs.readdirSync(SETTINGS.draftDir)) {
    if (!fileName.startsWith(`${processId}-`)) continue;
    const filePath = path.resolve(SETTINGS.draftDir, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

export function openOutlookDraftFile(filePath: string): void {
  const resolvedPath = path.resolve(filePath);
  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", resolvedPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return;
  }
  if (process.platform === "darwin") {
    const child = spawn("open", [resolvedPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }
  const child = spawn("xdg-open", [resolvedPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
