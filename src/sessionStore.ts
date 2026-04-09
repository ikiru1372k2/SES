import fs from "node:fs";
import path from "node:path";
import { SETTINGS } from "./config.js";
import type { Snapshot } from "./types.js";
import { ensureDir } from "./utils.js";

interface SessionIndex {
  sessions: Record<string, { versions: number[]; latestPreview?: string }>;
}

function readIndex(): SessionIndex {
  ensureDir(path.dirname(SETTINGS.sessionStoreFile));
  if (!fs.existsSync(SETTINGS.sessionStoreFile)) {
    return { sessions: {} };
  }
  return JSON.parse(fs.readFileSync(SETTINGS.sessionStoreFile, "utf8")) as SessionIndex;
}

function writeIndex(index: SessionIndex): void {
  ensureDir(path.dirname(SETTINGS.sessionStoreFile));
  fs.writeFileSync(SETTINGS.sessionStoreFile, JSON.stringify(index, null, 2), "utf8");
}

export function upsertSession(snapshot: Snapshot, previewPath: string): void {
  const index = readIndex();
  const entry = index.sessions[snapshot.sessionId] ?? { versions: [] };
  if (!entry.versions.includes(snapshot.version)) {
    entry.versions.push(snapshot.version);
    entry.versions.sort((left, right) => left - right);
  }
  entry.latestPreview = previewPath;
  index.sessions[snapshot.sessionId] = entry;
  writeIndex(index);
}

export function readSessionIndex(): SessionIndex {
  return readIndex();
}

export function deleteSession(sessionId: string): void {
  const index = readIndex();
  if (index.sessions[sessionId]) {
    delete index.sessions[sessionId];
    writeIndex(index);
  }
}
