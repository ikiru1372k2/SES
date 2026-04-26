import { OPERATORS } from './operators';
import type { AiRuleNode } from './types';
import type { ColumnResolver } from './columnResolver';

const MAX_DEPTH = 2;

export interface EvaluateContext {
  resolver: ColumnResolver;
  unknownColumns?: Set<string>;
}

export function evaluateNode(
  row: Record<string, unknown>,
  node: AiRuleNode,
  ctx: EvaluateContext,
  depth = 0,
): boolean {
  if (depth > MAX_DEPTH) {
    throw new Error(`AI rule nesting depth exceeds ${MAX_DEPTH}`);
  }

  if (node.op === 'and') {
    return node.children.every((c) => evaluateNode(row, c, ctx, depth + 1));
  }
  if (node.op === 'or') {
    return node.children.some((c) => evaluateNode(row, c, ctx, depth + 1));
  }
  return evaluateLeaf(row, node as Extract<AiRuleNode, { column: string }>, ctx);
}

function evaluateLeaf(
  row: Record<string, unknown>,
  node: Extract<AiRuleNode, { column: string }>,
  ctx: EvaluateContext,
): boolean {
  const realCol = ctx.resolver.resolve(node.column);
  if (!realCol) {
    ctx.unknownColumns?.add(node.column);
    return false;
  }
  const cell = row[realCol];

  let compareCell: unknown = undefined;
  if (node.op === '%>' && node.compareTo) {
    const realCompare = ctx.resolver.resolve(node.compareTo);
    if (!realCompare) {
      ctx.unknownColumns?.add(node.compareTo);
      return false;
    }
    compareCell = row[realCompare];
  }

  return OPERATORS[node.op]({
    cell,
    value: node.value,
    values: node.values,
    compareCell,
  });
}
