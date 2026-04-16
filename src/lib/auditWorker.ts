import { runAudit } from './auditEngine';
import type { AuditPolicy, AuditResult, WorkbookFile } from './types';

export type AuditWorkerRequest = { file: WorkbookFile; policy: AuditPolicy };
export type AuditWorkerResponse = { ok: true; result: AuditResult } | { ok: false; error: string };

self.onmessage = (event: MessageEvent<AuditWorkerRequest>) => {
  try {
    self.postMessage({ ok: true, result: runAudit(event.data.file, event.data.policy) } satisfies AuditWorkerResponse);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Audit failed' } satisfies AuditWorkerResponse);
  }
};
