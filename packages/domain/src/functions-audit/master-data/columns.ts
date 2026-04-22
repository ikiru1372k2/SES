// Authoritative column-name list for the Master Data function. Matches
// the headers produced by the finance team's master-data export. Aliases
// cover both the original export header and common normalised spellings so
// the engine works whether the sheet was passed through the header
// normaliser or not.
//
// To add a new required field: append a `MD_COLUMNS.<key>` entry, then add
// it to `MD_REQUIRED_COLUMNS` in the user-facing order. The rule code is
// generated deterministically from the column id (`RUL-MD-<ID>-MISSING`),
// so a matching catalog entry appears automatically in `rules.ts`.

import type { RowObject } from '../types';

export interface ColumnSpec {
  id: string;        // stable internal id, also used in rule codes
  label: string;     // human-readable label shown in findings
  aliases: string[]; // header strings to look up in the row object
}

// Identifier-only alias arrays kept as standalone exports because the
// engine reads them in a different code path (issue identifiers attached
// to every finding, regardless of which rule fired). These columns are
// intentionally NOT in MD_REQUIRED_COLUMNS — Project No., Project, Project
// State, and email are part of every row but the business owners decided
// not to audit them as required fields. They're still needed so each
// finding can show "Project No: 90032101" and so on.
export const MD_PROJECT_NO_ALIASES = ['Project No.', 'Project No', 'Project Number', 'projectNo'];
export const MD_PROJECT_NAME_ALIASES = ['Project', 'Project Name', 'projectName', 'Name'];
export const MD_EMAIL_ALIASES = ['Project Manager Email', 'Manager Email', 'email', 'Email'];
export const MD_STATE_ALIASES = ['Project State', 'projectState', 'State'];

export const MD_COLUMNS = {
  customerName: {
    id: 'customer_name',
    label: 'Customer name',
    aliases: ['Customer name', 'Customer Name', 'customerName'],
  },
  endCustomerName: {
    id: 'end_customer_name',
    label: 'End Customer Name',
    aliases: ['End Customer Name', 'endCustomerName'],
  },
  projectManager: {
    id: 'project_manager',
    label: 'Project Manager',
    aliases: ['Project Manager', 'projectManager', 'Manager'],
  },
  projectCountryManager: {
    id: 'project_country_manager',
    label: 'Project Country Manager',
    aliases: ['Project Country Manager', 'projectCountryManager'],
  },
  projectBuHead: {
    id: 'project_bu_head',
    label: 'Project BU Head',
    aliases: ['Project BU Head', 'projectBuHead'],
  },
  accountManager: {
    id: 'account_manager',
    label: 'Account Manager',
    aliases: ['Account Manager', 'accountManager'],
  },
  projectIndustry: {
    id: 'project_industry',
    label: 'Project Industry',
    aliases: ['Project Industry', 'projectIndustry'],
  },
  endCustomerIndustry: {
    id: 'end_customer_industry',
    label: 'End Customer Industry',
    aliases: ['End Customer Industry', 'endCustomerIndustry'],
  },
  useCase: {
    id: 'use_case',
    label: 'Use Case',
    aliases: ['Use Case', 'useCase'],
  },
  projectProduct: {
    id: 'project_product',
    label: 'Project Product',
    aliases: ['Project Product', 'projectProduct'],
  },
} as const satisfies Record<string, ColumnSpec>;

// Required-field set, in the user-facing order the business owners use
// when reviewing audit findings. Every column here generates a
// `RUL-MD-<ID>-MISSING` rule via `missingFieldRuleCode` in `rules.ts`.
//
// Project Product appears here so it gets a MISSING rule code in the
// catalog, but the engine handles it specially (three rules: missing,
// not-assigned, review-others). See `engine.ts` for the dispatch.
export const MD_REQUIRED_COLUMNS: ColumnSpec[] = [
  MD_COLUMNS.customerName,
  MD_COLUMNS.endCustomerName,
  MD_COLUMNS.projectManager,
  MD_COLUMNS.projectCountryManager,
  MD_COLUMNS.projectBuHead,
  MD_COLUMNS.accountManager,
  MD_COLUMNS.projectIndustry,
  MD_COLUMNS.endCustomerIndustry,
  MD_COLUMNS.useCase,
  MD_COLUMNS.projectProduct,
];

export function readCell(row: RowObject, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) {
      const value = row[alias];
      if (value !== undefined) return value;
    }
  }
  return undefined;
}