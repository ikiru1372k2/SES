// Authoritative column-name list for the Master Data function. Matches
// the headers produced by the finance team's master-data export (see
// excel_sample_for_audit/Sample Master Data file.xlsx). Aliases cover both
// the original export header and common normalised spellings so the engine
// works whether the sheet was passed through the header-normaliser or not.

import type { RowObject } from '../types';

export interface ColumnSpec {
  id: string;        // stable internal id, also used in rule codes
  label: string;     // human-readable label shown in findings
  aliases: string[]; // header strings to look up in the row object
}

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

export const MD_PROJECT_NO_ALIASES = ['Project No.', 'Project No', 'Project Number', 'projectNo'];
export const MD_PROJECT_NAME_ALIASES = ['Project', 'Project Name', 'projectName', 'Name'];
export const MD_EMAIL_ALIASES = ['Project Manager Email', 'Manager Email', 'email', 'Email'];
export const MD_STATE_ALIASES = ['Project State', 'projectState', 'State'];

export function readCell(row: RowObject, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) {
      const value = row[alias];
      if (value !== undefined) return value;
    }
  }
  return undefined;
}
