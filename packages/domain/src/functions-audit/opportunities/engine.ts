import { createIssueKey } from '../../auditEngine';
import type { AuditIssue, AuditPolicy, AuditResult, WorkbookFile } from '../../types';
import type { FunctionAuditEngine, FunctionAuditOptions, RowObject } from '../types';
import {
  OPP_BCS_FLAG_ALIASES,
  OPP_BUSINESS_UNIT_ALIASES,
  OPP_CATEGORY_ALIASES,
  OPP_CLS_DATE_ALIASES,
  OPP_CLS_DATE_PAST_ALIASES,
  OPP_COUNTRY_ALIASES,
  OPP_NAME_ALIASES,
  OPP_PRJ_START_PAST_ALIASES,
  OPP_PROBABILITY_ALIASES,
  OPP_PROJECT_NO_ALIASES,
  isBcsBlank,
  isBcsMissing,
  readBoolean,
  readCell,
  readNumber,
  readText,
} from './columns';
import {
  OPP_BCS_AVAILABLE_LOW_PROB_RULE_CODE,
  OPP_BCS_MISSING_RULE_CODE,
  OPP_CLOSED_DATE_PAST_LOW_PROB_RULE_CODE,
  OPP_CLOSED_DATE_PAST_RULE_CODE,
  OPP_COMPOSITE_RULE_CODE,
  OPP_INCORRECT_BU_RULE_CODE,
  OPP_PROJECT_START_PAST_LOW_PROB_RULE_CODE,
  OPPORTUNITIES_RULES_BY_CODE,
} from './rules';

// Per-engine config slice. Stored under `AuditPolicy.opportunities` so other
// engines never read these fields. Values are optional; the engine falls
// back to DEFAULT_OPPORTUNITIES_POLICY when a field is absent.
export interface OpportunitiesPolicy {
  closeDateLowProbabilityMax?: number;
  projectStartLowProbabilityMax?: number;
  missingBcsProbabilityExact?: number;
  bcsAvailableLowProbabilityMax?: number;
  brazilExpectedBu?: string;
}

export const DEFAULT_OPPORTUNITIES_POLICY: Required<OpportunitiesPolicy> = {
  closeDateLowProbabilityMax: 75,
  projectStartLowProbabilityMax: 90,
  missingBcsProbabilityExact: 90,
  bcsAvailableLowProbabilityMax: 90,
  brazilExpectedBu: 'Brazil',
};

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => String(cell ?? '').trim() === '');
}

// Same shape as missing-plan/engine.ts:rowsToObjects — keep an inline copy
// per the engine-isolation convention (each engine owns its own helpers).
function rowsToObjects(
  rows: unknown[][],
  headerRowIndex: number,
  normalizedHeaders?: string[],
): Array<{ row: RowObject; rowIndex: number }> {
  const originalHeaders = (rows[headerRowIndex] ?? []).map((cell) => String(cell ?? '').trim());
  const headers = normalizedHeaders?.length ? normalizedHeaders : originalHeaders;
  return rows
    .slice(headerRowIndex + 1)
    .map((row, index) => ({ cells: row, rowIndex: headerRowIndex + 1 + index }))
    .filter(({ cells }) => !isBlankRow(cells))
    .map(({ cells, rowIndex }) => {
      const row: RowObject = {};
      headers.forEach((header, index) => {
        const originalHeader = originalHeaders[index];
        const cell = cells[index];
        const canonicalKey = String(header ?? '').trim();
        const originalKey = String(originalHeader ?? '').trim();
        if (canonicalKey && !canonicalKey.startsWith('column') && row[canonicalKey] === undefined) {
          row[canonicalKey] = cell;
        }
        if (originalKey && row[originalKey] === undefined) {
          row[originalKey] = cell;
        }
      });
      return { row, rowIndex };
    });
}

interface RuleHit {
  code: string;
  message: string;
}

function pushIssue(
  issues: AuditIssue[],
  args: {
    file: WorkbookFile;
    sheetName: string;
    rowIndex: number;
    row: RowObject;
    hits: RuleHit[];
    options: FunctionAuditOptions;
  },
): void {
  const { file, sheetName, rowIndex, row, hits, options } = args;
  if (hits.length === 0) return;

  // Hybrid rule code: specific when 1 hit, COMPOSITE when 2+. Reason text
  // always carries every triggered message joined by '; '.
  const ruleCode = hits.length === 1 ? hits[0]!.code : OPP_COMPOSITE_RULE_CODE;
  const rule = OPPORTUNITIES_RULES_BY_CODE.get(ruleCode);
  if (!rule) return;

  const combinedReason = hits.map((h) => h.message).join('; ');
  const matchedCodesNote =
    hits.length > 1 ? ` [matched: ${hits.map((h) => h.code).join(', ')}]` : '';
  const notes = `${combinedReason}${matchedCodesNote}`;

  const oppId = readText(row, OPP_PROJECT_NO_ALIASES) || `Row ${rowIndex + 1}`;
  const opportunityName = readText(row, OPP_NAME_ALIASES) || 'Unnamed opportunity';
  const category = readText(row, OPP_CATEGORY_ALIASES) || 'Unknown';
  const probability = readNumber(readCell(row, OPP_PROBABILITY_ALIASES));

  issues.push({
    id: `${file.id}-${sheetName}-${rowIndex}-${ruleCode}`,
    ...(options.issueScope
      ? {
          issueKey: createIssueKey(options.issueScope, {
            projectNo: oppId,
            sheetName,
            rowIndex,
            ruleCode,
          }),
        }
      : {}),
    projectNo: oppId,
    projectName: opportunityName,
    sheetName,
    severity: rule.defaultSeverity,
    projectManager: '—',
    projectState: category,
    effort: probability ?? 0,
    auditStatus: ruleCode,
    notes,
    rowIndex,
    email: '',
    ruleId: ruleCode,
    ruleCode,
    ruleVersion: rule.version,
    ruleName: rule.name,
    auditRunCode: options.runCode,
    category: rule.category,
    reason: combinedReason,
    thresholdLabel: 'opportunity-checks',
    recommendedAction:
      'Review the opportunity record and correct the flagged fields in the source CRM.',
  });
}

function auditRow(args: {
  file: WorkbookFile;
  sheetName: string;
  rowIndex: number;
  row: RowObject;
  options: FunctionAuditOptions;
  issues: AuditIssue[];
  closeDateLowProbabilityMax: number;
  projectStartLowProbabilityMax: number;
  missingBcsProbabilityExact: number;
  bcsAvailableLowProbabilityMax: number;
  brazilExpectedBuNorm: string;
}): boolean {
  const {
    file,
    sheetName,
    rowIndex,
    row,
    options,
    issues,
    closeDateLowProbabilityMax,
    projectStartLowProbabilityMax,
    missingBcsProbabilityExact,
    bcsAvailableLowProbabilityMax,
    brazilExpectedBuNorm,
  } = args;

  const probability = readNumber(readCell(row, OPP_PROBABILITY_ALIASES));
  const clsDateInPast = readBoolean(readCell(row, OPP_CLS_DATE_PAST_ALIASES));
  const prjStartInPast = readBoolean(readCell(row, OPP_PRJ_START_PAST_ALIASES));
  const categoryNorm = readText(row, OPP_CATEGORY_ALIASES).toLowerCase();
  const countryNorm = readText(row, OPP_COUNTRY_ALIASES).toLowerCase();
  const businessUnitNorm = readText(row, OPP_BUSINESS_UNIT_ALIASES).toLowerCase();
  const bcsRaw = readCell(row, OPP_BCS_FLAG_ALIASES);

  const hits: RuleHit[] = [];

  // 1. Close date in past (always fires when CLS_DATE_IN_PAST=true).
  if (clsDateInPast) {
    hits.push({
      code: OPP_CLOSED_DATE_PAST_RULE_CODE,
      message: 'Opportunity closed date in past',
    });
  }

  // 2. Close date in past + low probability (composite-friendly: rule 1 also
  //    fires per locked decision 7 — both messages appear).
  if (clsDateInPast && probability !== null && probability < closeDateLowProbabilityMax) {
    hits.push({
      code: OPP_CLOSED_DATE_PAST_LOW_PROB_RULE_CODE,
      message: 'Opportunity closed date in past with low probability',
    });
  }

  // 3. Project start in past + low probability.
  if (prjStartInPast && probability !== null && probability < projectStartLowProbabilityMax) {
    hits.push({
      code: OPP_PROJECT_START_PAST_LOW_PROB_RULE_CODE,
      message: 'Project start date in past with low probability',
    });
  }

  // 4. BCS missing — strictly Service + probability == exact threshold +
  //    BCS_FLAG == '#'. Empty cells do NOT trigger this rule per locked
  //    decision 5.
  if (
    categoryNorm === 'service' &&
    probability !== null &&
    probability === missingBcsProbabilityExact &&
    isBcsMissing(bcsRaw)
  ) {
    hits.push({ code: OPP_BCS_MISSING_RULE_CODE, message: 'BCS code missing' });
  }

  // 5. BCS available with <90% — Service + probability < threshold + BCS
  //    present (non-blank, non-'#'). Empty cells are NOT "available".
  if (
    categoryNorm === 'service' &&
    probability !== null &&
    probability < bcsAvailableLowProbabilityMax &&
    !isBcsMissing(bcsRaw) &&
    !isBcsBlank(bcsRaw)
  ) {
    hits.push({
      code: OPP_BCS_AVAILABLE_LOW_PROB_RULE_CODE,
      message: 'BCS code available with less than 90%',
    });
  }

  // 6. Brazil BU mismatch — case-insensitive trimmed comparison.
  if (countryNorm === 'brazil' && businessUnitNorm !== brazilExpectedBuNorm) {
    hits.push({ code: OPP_INCORRECT_BU_RULE_CODE, message: 'Incorrect BU mapping' });
  }

  if (hits.length === 0) return false;
  pushIssue(issues, { file, sheetName, rowIndex, row, hits, options });
  return true;
}

export const opportunitiesAuditEngine: FunctionAuditEngine = {
  functionId: 'opportunities',
  run(file, policy, options) {
    // Read ONLY from the namespaced opportunities slice. No top-level
    // AuditPolicy fields are consulted — guarantees this engine cannot
    // accidentally pick up settings from any other engine and vice versa.
    const blob = policy as
      | (AuditPolicy & { opportunities?: OpportunitiesPolicy })
      | undefined;
    const opp = blob?.opportunities ?? {};
    const closeDateLowProbabilityMax =
      opp.closeDateLowProbabilityMax ?? DEFAULT_OPPORTUNITIES_POLICY.closeDateLowProbabilityMax;
    const projectStartLowProbabilityMax =
      opp.projectStartLowProbabilityMax ?? DEFAULT_OPPORTUNITIES_POLICY.projectStartLowProbabilityMax;
    const missingBcsProbabilityExact =
      opp.missingBcsProbabilityExact ?? DEFAULT_OPPORTUNITIES_POLICY.missingBcsProbabilityExact;
    const bcsAvailableLowProbabilityMax =
      opp.bcsAvailableLowProbabilityMax ?? DEFAULT_OPPORTUNITIES_POLICY.bcsAvailableLowProbabilityMax;
    const brazilExpectedBuNorm = (opp.brazilExpectedBu ?? DEFAULT_OPPORTUNITIES_POLICY.brazilExpectedBu)
      .trim()
      .toLowerCase();

    const issues: AuditIssue[] = [];
    const sheetResults = file.sheets
      .filter((sheet) => sheet.status === 'valid' && sheet.isSelected)
      .map((sheet) => {
        const rows = rowsToObjects(
          file.rawData[sheet.name] ?? [],
          sheet.headerRowIndex ?? 0,
          sheet.normalizedHeaders,
        );
        let flaggedCount = 0;
        rows.forEach(({ row, rowIndex }) => {
          const flagged = auditRow({
            file,
            sheetName: sheet.name,
            rowIndex,
            row,
            options,
            issues,
            closeDateLowProbabilityMax,
            projectStartLowProbabilityMax,
            missingBcsProbabilityExact,
            bcsAvailableLowProbabilityMax,
            brazilExpectedBuNorm,
          });
          if (flagged) flaggedCount += 1;
        });
        return { sheetName: sheet.name, rowCount: rows.length, flaggedCount };
      });

    // Read CLS_DATE for any future use — currently unused at the engine level
    // (kept available via aliases for downstream context expansions).
    void OPP_CLS_DATE_ALIASES;

    const result: AuditResult = {
      fileId: file.id,
      runAt: new Date().toISOString(),
      scannedRows: sheetResults.reduce((sum, sheet) => sum + sheet.rowCount, 0),
      flaggedRows: sheetResults.reduce((sum, sheet) => sum + sheet.flaggedCount, 0),
      issues,
      sheets: sheetResults,
    };
    return result;
  },
};
