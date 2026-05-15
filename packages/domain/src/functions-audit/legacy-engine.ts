import { runAudit } from '../audit/auditEngine';
import type { AuditResult, WorkbookFile, AuditPolicy } from '../core/types';
import type { FunctionAuditEngine, FunctionAuditOptions } from './types';
import type { FunctionId } from '../project/functions';

// Wrapper around the original effort-oriented audit engine. The other four
// functions (over-planning, missing-plan, function-rate, internal-cost-rate)
// will get their own dedicated modules as the product requirements land —
// this wrapper keeps them functional in the meantime without pretending
// they have master-data-style rules.
export function createLegacyEngine(functionId: FunctionId): FunctionAuditEngine {
  return {
    functionId,
    run(file: WorkbookFile, policy: AuditPolicy | undefined, options: FunctionAuditOptions): AuditResult {
      return runAudit(file, policy, options);
    },
  };
}
