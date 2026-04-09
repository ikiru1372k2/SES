import { SETTINGS } from "./config.js";
import type {
  AuditIssue,
  AuditSummary,
  AuditedRow,
  EffortRow,
  IssueCategory,
  IssueCode,
  Severity,
} from "./types.js";

const severityRank: Record<Severity, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
};

const ISSUE_DEFINITIONS: Record<
  IssueCode,
  { label: string; category: IssueCategory; severity: Severity }
> = {
  MISSING_EFFORT: { label: "Missing Effort", category: "Data Quality", severity: "Medium" },
  PENDING_ESTIMATION: { label: "Pending Estimation", category: "Planning Issue", severity: "Medium" },
  ON_HOLD_WITH_NO_EFFORT: { label: "On Hold With No Effort", category: "Planning Issue", severity: "Low" },
  AUTHORISED_WITH_ZERO_EFFORT: { label: "Authorised Without Effort", category: "Planning Issue", severity: "High" },
  PRE_APPROVAL_EFFORT_ENTERED: { label: "Pre-Approval Effort Entered", category: "Planning Issue", severity: "Medium" },
  HIGH_EFFORT_PROJECT: { label: "High Effort", category: "Capacity Risk", severity: "High" },
  ELEVATED_EFFORT_PROJECT: { label: "Elevated Effort", category: "Capacity Risk", severity: "Medium" },
  MISSING_CONTACT_DATA: { label: "Missing Contact Data", category: "Data Quality", severity: "Medium" },
  DUPLICATE_PROJECT_NUMBER: { label: "Duplicate Project Number", category: "Data Quality", severity: "High" },
};

function makeIssue(code: IssueCode, details?: string): AuditIssue {
  const definition = ISSUE_DEFINITIONS[code];
  return {
    code,
    label: definition.label,
    category: definition.category,
    severity: definition.severity,
    details,
  };
}

function computeHighestSeverity(issues: AuditIssue[]): Severity | null {
  return issues.reduce<Severity | null>((highest, issue) => {
    if (!highest || severityRank[issue.severity] > severityRank[highest]) {
      return issue.severity;
    }
    return highest;
  }, null);
}

function computeAuditStatus(issues: AuditIssue[]): string {
  if (issues.length === 0) {
    return "OK";
  }

  if (issues.some((issue) => issue.code === "AUTHORISED_WITH_ZERO_EFFORT")) {
    return "Authorised Without Effort";
  }

  if (issues.some((issue) => issue.code === "PENDING_ESTIMATION")) {
    return "Pending Estimation";
  }

  if (issues.some((issue) => issue.code === "HIGH_EFFORT_PROJECT")) {
    return "High Effort";
  }

  return issues[0].label;
}

function computeAuditNotes(issues: AuditIssue[]): string {
  return issues.map((issue) => issue.details ?? issue.label).join("; ");
}

export function auditRows(rows: EffortRow[]): { rows: AuditedRow[]; summary: AuditSummary } {
  const duplicateProjectNumbers = new Set(
    rows
      .map((row) => row.projectNo)
      .filter((projectNo, index, projectNos) => projectNo && projectNos.indexOf(projectNo) !== index),
  );

  const auditedRows = rows.map<AuditedRow>((row) => {
    const issues: AuditIssue[] = [];
    const state = row.projectState;
    const effort = row.effortHours;

    if (effort === null) {
      issues.push(makeIssue("MISSING_EFFORT", "Effort value is missing or non-numeric."));
    }

    if (!row.projectManager || !row.projectCountryManager || !row.email) {
      issues.push(makeIssue("MISSING_CONTACT_DATA", "Project manager, country manager, or email is missing."));
    }

    if (duplicateProjectNumbers.has(row.projectNo)) {
      issues.push(makeIssue("DUPLICATE_PROJECT_NUMBER", `Project number ${row.projectNo} appears more than once.`));
    }

    if (state === "In Planning" && effort === 0) {
      issues.push(makeIssue("PENDING_ESTIMATION", "Project is still in planning with zero effort."));
    }

    if (state === "On Hold" && effort === 0) {
      issues.push(makeIssue("ON_HOLD_WITH_NO_EFFORT", "On hold project currently carries zero effort."));
    }

    if (state === "Authorised" && effort === 0) {
      issues.push(makeIssue("AUTHORISED_WITH_ZERO_EFFORT", "Authorised project should not have zero effort."));
    }

    if ((state === "In Planning" || state === "On Hold") && typeof effort === "number" && effort > 0) {
      issues.push(makeIssue("PRE_APPROVAL_EFFORT_ENTERED", "Pre-approval project already has effort assigned."));
    }

    if (typeof effort === "number" && effort >= SETTINGS.thresholds.highEffortHours) {
      issues.push(makeIssue("HIGH_EFFORT_PROJECT", `Effort is ${effort}h, above the ${SETTINGS.thresholds.highEffortHours}h high-risk threshold.`));
    } else if (typeof effort === "number" && effort >= SETTINGS.thresholds.elevatedEffortHours) {
      issues.push(makeIssue("ELEVATED_EFFORT_PROJECT", `Effort is ${effort}h, above the ${SETTINGS.thresholds.elevatedEffortHours}h elevated threshold.`));
    }

    const highestSeverity = computeHighestSeverity(issues);

    return {
      ...row,
      issues,
      highestSeverity,
      auditStatus: computeAuditStatus(issues),
      auditSeverity: highestSeverity ?? "OK",
      auditNotes: computeAuditNotes(issues),
    };
  });

  const summary: AuditSummary = {
    totalRows: auditedRows.length,
    flaggedRows: auditedRows.filter((row) => row.issues.length > 0).length,
    issueCount: auditedRows.reduce((total, row) => total + row.issues.length, 0),
    bySeverity: { High: 0, Medium: 0, Low: 0 },
    byCategory: { "Data Quality": 0, "Planning Issue": 0, "Capacity Risk": 0 },
  };

  for (const row of auditedRows) {
    for (const issue of row.issues) {
      summary.bySeverity[issue.severity] += 1;
      summary.byCategory[issue.category] += 1;
    }
  }

  return { rows: auditedRows, summary };
}
