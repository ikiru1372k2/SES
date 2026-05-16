// Authoritative column-name list for Master Data. Aliases cover original + normalised header spellings.
// To add a new required field: append a `MD_COLUMNS.<key>` entry, then add it to `MD_REQUIRED_COLUMNS`.
// The rule code is generated deterministically (`RUL-MD-<ID>-MISSING`) so a catalog entry appears automatically.

import type { RowObject } from '../types';

export interface ColumnSpec {
  id: string;        // stable internal id, also used in rule codes
  label: string;     // human-readable label shown in findings
  aliases: string[]; // header strings to look up in the row object
}

// Identifier aliases — read separately for finding metadata; intentionally NOT in MD_REQUIRED_COLUMNS.
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

// Required-field set in business-owner order. Each generates `RUL-MD-<ID>-MISSING`.
// Project Product is here for the catalog code but the engine handles it specially (see engine.ts).
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