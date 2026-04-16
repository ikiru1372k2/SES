import { runAudit } from './auditEngine';
import type { AuditPolicy, AuditResult, WorkbookFile } from './types';
import type { AuditWorkerResponse } from './auditWorker';

export function runAuditAsync(file: WorkbookFile, policy: AuditPolicy): Promise<AuditResult> {
  if (typeof Worker === 'undefined') return Promise.resolve(runAudit(file, policy));

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./auditWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<AuditWorkerResponse>) => {
      worker.terminate();
      if (event.data.ok) {
        resolve(event.data.result);
        return;
      }
      reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Audit worker failed'));
    };
    worker.postMessage({ file, policy });
  });
}
