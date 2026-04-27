import type { IssueCategory, Severity } from '../types';
import type { FunctionId } from '../functions';

export type AiRuleOperator =
  | '>'
  | '<'
  | '>='
  | '<='
  | '=='
  | '!='
  | '%>'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'isBlank'
  | 'isOneOf'
  | 'isMissing'
  | 'isNotMissing';

export type AiRuleNode =
  | { op: 'and' | 'or'; children: AiRuleNode[] }
  | {
      op: AiRuleOperator;
      column: string;
      value?: unknown;
      values?: unknown[];
      compareTo?: string;
    };

export interface AiRuleSpec {
  ruleCode: string;
  ruleVersion: number;
  functionId: FunctionId;
  name: string;
  category: IssueCategory;
  severity: Severity;
  flagMessage: string;
  logic: AiRuleNode;
}
