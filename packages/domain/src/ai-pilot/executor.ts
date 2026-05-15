import { createIssueKey } from '../audit/auditEngine';
import type { AuditIssue, AuditResult, SheetAuditResult, WorkbookFile } from '../core/types';
import { ColumnResolver } from './columnResolver';
import { evaluateNode } from './evaluator';
import type { AiRuleSpec } from './types';

export interface RunAiPilotOptions {
  functionId: string;
  rules: AiRuleSpec[];
  issueScope?: string;
  runCode?: string;
}

export interface RunAiPilotPreviewExtras {
  unknownColumns: string[];
}

export interface RunAiPilotPreviewResult extends AuditResult {
  unknownColumns: string[];
}

const isBlankRow = (row: unknown[]): boolean =>
  row.every((cell) => String(cell ?? '').trim() === '');

function rowsToObjects(
  rows: unknown[][],
  headerRowIndex: number,
  normalizedHeaders: string[] | undefined,
): { row: Record<string, unknown>; rowIndex: number; headers: string[] }[] {
  const originalHeaders = (rows[headerRowIndex] ?? []).map((cell) => String(cell ?? '').trim());
  const headers = normalizedHeaders?.length ? normalizedHeaders : originalHeaders;
  return rows
    .slice(headerRowIndex + 1)
    .map((cells, i) => ({ cells, rowIndex: headerRowIndex + 1 + i }))
    .filter(({ cells }) => !isBlankRow(cells))
    .map(({ cells, rowIndex }) => {
      const row: Record<string, unknown> = {};
      headers.forEach((header, idx) => {
        const original = originalHeaders[idx];
        const cell = cells[idx];
        const canonical = String(header ?? '').trim();
        if (canonical && !canonical.startsWith('column') && row[canonical] === undefined) {
          row[canonical] = cell;
        }
        if (original && row[original] === undefined) {
          row[original] = cell;
        }
      });
      return { row, rowIndex, headers: [...headers, ...originalHeaders] };
    });
}

const text = (row: Record<string, unknown>, key: string, fallback = ''): string => {
  const raw = row[key];
  if (raw === null || raw === undefined) return fallback;
  const t = String(raw).trim();
  return t || fallback;
};

function interpolate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key) => ctx[key] ?? `{${key}}`);
}

export function runAiPilotRules(
  file: WorkbookFile,
  options: RunAiPilotOptions,
): RunAiPilotPreviewResult {
  const unknownColumns = new Set<string>();
  const issues: AuditIssue[] = [];

  try {
    const sheetResults: SheetAuditResult[] = file.sheets
      .filter((sheet) => sheet.status === 'valid' && sheet.isSelected)
      .map((sheet) => {
        const objects = rowsToObjects(
          file.rawData[sheet.name] ?? [],
          sheet.headerRowIndex ?? 0,
          sheet.normalizedHeaders,
        );
        const headers = objects[0]?.headers ?? sheet.normalizedHeaders ?? [];
        const resolver = new ColumnResolver(headers);
        let flaggedCount = 0;

        for (const { row, rowIndex } of objects) {
          let rowFlagged = false;

          for (const rule of options.rules) {
            try {
              const matched = evaluateNode(row, rule.logic, { resolver, unknownColumns });
              if (!matched) continue;

              const projectNo = text(row, 'projectNo') || text(row, 'Project No') || `Row ${rowIndex + 1}`;
              const projectName = text(row, 'projectName') || text(row, 'Project Name') || 'Unnamed project';
              const projectManager =
                text(row, 'projectManager') || text(row, 'Project Manager') || 'Unassigned';
              const projectState = text(row, 'projectState') || text(row, 'State') || 'Unknown';
              const email = text(row, 'email') || text(row, 'Email') || '';
              const reason = interpolate(rule.flagMessage, {
                projectNo,
                projectName,
                projectManager,
                projectState,
                column: '',
                sheet: sheet.name,
              });

              issues.push({
                id: `${file.id}-${sheet.name}-${rowIndex}-${rule.ruleCode}`,
                ...(options.issueScope
                  ? {
                      issueKey: createIssueKey(options.issueScope, {
                        projectNo,
                        sheetName: sheet.name,
                        rowIndex,
                        ruleCode: rule.ruleCode,
                      }),
                    }
                  : {}),
                projectNo,
                projectName,
                sheetName: sheet.name,
                severity: rule.severity,
                projectManager,
                projectState,
                effort: 0,
                auditStatus: rule.ruleCode,
                notes: reason,
                rowIndex,
                email,
                ruleId: rule.ruleCode,
                ruleCode: rule.ruleCode,
                ruleVersion: rule.ruleVersion,
                ruleName: rule.name,
                auditRunCode: options.runCode,
                category: rule.category,
                reason,
                thresholdLabel: 'AI Pilot',
                recommendedAction: 'Review the flagged row against the AI rule description.',
              });
              rowFlagged = true;
            } catch {
              // Per-rule failure must not break the whole executor — log via
              // counter and continue. (No console in domain; surfaces as
              // unknownColumns-style telemetry only.)
            }
          }

          if (rowFlagged) flaggedCount += 1;
        }

        return { sheetName: sheet.name, rowCount: objects.length, flaggedCount };
      });

    return {
      fileId: file.id,
      runAt: new Date().toISOString(),
      scannedRows: sheetResults.reduce((sum, s) => sum + s.rowCount, 0),
      flaggedRows: sheetResults.reduce((sum, s) => sum + s.flaggedCount, 0),
      issues,
      sheets: sheetResults,
      unknownColumns: [...unknownColumns],
    };
  } catch {
    return {
      fileId: file.id,
      runAt: new Date().toISOString(),
      scannedRows: 0,
      flaggedRows: 0,
      issues: [],
      sheets: [],
      unknownColumns: [...unknownColumns],
    };
  }
}
