import fs from "node:fs";
import path from "node:path";
import { SETTINGS } from "./config.js";
import type { NotificationDraft } from "./types.js";
import { ensureDir, slugify } from "./utils.js";

export function writePreviewFiles(sessionId: string, drafts: NotificationDraft[]): string[] {
  ensureDir(SETTINGS.previewDir);

  return drafts.map((draft) => {
    const fileName = `${sessionId}-${slugify(draft.recipientEmail)}.html`;
    const filePath = path.resolve(SETTINGS.previewDir, fileName);
    fs.writeFileSync(filePath, draft.html, "utf8");
    return filePath;
  });
}

export function deletePreviewFiles(sessionId: string): void {
  ensureDir(SETTINGS.previewDir);
  for (const fileName of fs.readdirSync(SETTINGS.previewDir)) {
    if (fileName.startsWith(`${sessionId}-`)) {
      const filePath = path.resolve(SETTINGS.previewDir, fileName);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
}
