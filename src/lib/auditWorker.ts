import { runAudit } from './auditEngine';
import type { AuditPolicy, WorkbookFile } from './types';

self.onmessage = (event: MessageEvent<{ file: WorkbookFile; policy: AuditPolicy }>) => {
  const result = runAudit(event.data.file, event.data.policy);
  self.postMessage(result);
};
