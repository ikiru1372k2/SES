import type { FunctionId } from '../project/functions';
import type { AuditIssue, AuditPolicy, AuditResult, WorkbookFile } from '../core/types';

export interface FunctionAuditOptions {
  issueScope?: string;
  runCode?: string;
}

// A per-function engine owns its own rules. The registry below hands the
// workbook + policy off to the engine that matches the file's functionId
// and returns a standard AuditResult.
export interface FunctionAuditEngine {
  functionId: FunctionId;
  run(file: WorkbookFile, policy: AuditPolicy | undefined, options: FunctionAuditOptions): AuditResult;
}

export type RowObject = Record<string, unknown>;

export interface EvaluatedRow {
  row: RowObject;
  rowIndex: number;
}

// Small helper type the per-rule checkers produce. The engine turns these
// into AuditIssue records. Keeping it separate from AuditIssue lets each
// function produce richer context without having to synthesize every field.
export interface RuleFinding {
  ruleCode: string;
  severity: AuditIssue['severity'];
  reason: string;
  thresholdLabel: string;
  recommendedAction: string;
  category: AuditIssue['category'];
}
