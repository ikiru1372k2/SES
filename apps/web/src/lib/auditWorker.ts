import { runFunctionAudit } from '@ses/domain';
import type { AuditPolicy, AuditResult, WorkbookFile } from './types';

export type AuditWorkerRequest = { file: WorkbookFile; functionId: string | undefined; policy: AuditPolicy };
export type AuditWorkerResponse = { ok: true; result: AuditResult } | { ok: false; error: string };

self.onmessage = (event: MessageEvent<AuditWorkerRequest>) => {
  try {
    const result = runFunctionAudit(event.data.functionId, event.data.file, event.data.policy);
    self.postMessage({ ok: true, result } satisfies AuditWorkerResponse);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Audit failed' } satisfies AuditWorkerResponse);
  }
};
