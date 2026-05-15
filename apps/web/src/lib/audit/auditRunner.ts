import { runFunctionAudit } from '@ses/domain';
import type { AuditPolicy, AuditResult, WorkbookFile } from '../domain/types';
import type { AuditWorkerResponse } from './auditWorker';

// Route every client-side audit through the per-function dispatcher so the
// rules that execute in the browser match what the server would run. A
// Master Data file must not be audited with effort rules just because a
// Worker isn't available.
export function runAuditAsync(
  file: WorkbookFile,
  functionId: string | undefined,
  policy: AuditPolicy,
): Promise<AuditResult> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(runFunctionAudit(functionId, file, policy));
  }

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
    worker.postMessage({ file, functionId, policy });
  });
}
