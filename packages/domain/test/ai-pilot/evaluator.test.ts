import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNode } from '../../src/ai-pilot/evaluator.js';
import { ColumnResolver } from '../../src/ai-pilot/columnResolver.js';

const r = (h: string[]) => new ColumnResolver(h);

test('numeric > operator', () => {
  const resolver = r(['Effort']);
  assert.equal(
    evaluateNode({ Effort: 250 }, { op: '>', column: 'Effort', value: 200 }, { resolver }),
    true,
  );
  assert.equal(
    evaluateNode({ Effort: 100 }, { op: '>', column: 'Effort', value: 200 }, { resolver }),
    false,
  );
});

test('isBlank operator catches null, undefined, whitespace', () => {
  const resolver = r(['State']);
  assert.equal(evaluateNode({ State: '' }, { op: 'isBlank', column: 'State' }, { resolver }), true);
  assert.equal(evaluateNode({ State: '   ' }, { op: 'isBlank', column: 'State' }, { resolver }), true);
  assert.equal(evaluateNode({ State: null }, { op: 'isBlank', column: 'State' }, { resolver }), true);
  assert.equal(evaluateNode({ State: 'Active' }, { op: 'isBlank', column: 'State' }, { resolver }), false);
});

test('contains is case-insensitive', () => {
  const resolver = r(['Notes']);
  assert.equal(
    evaluateNode({ Notes: 'Please REVIEW soon' }, { op: 'contains', column: 'Notes', value: 'review' }, { resolver }),
    true,
  );
});

test('isOneOf checks membership', () => {
  const resolver = r(['Product']);
  assert.equal(
    evaluateNode(
      { Product: 'Others' },
      { op: 'isOneOf', column: 'Product', values: ['TBD', 'Others', 'Unknown'] },
      { resolver },
    ),
    true,
  );
});

test('%> operator: cell exceeds compareTo by more than N percent', () => {
  const resolver = r(['Actual', 'Planned']);
  assert.equal(
    evaluateNode(
      { Actual: 120, Planned: 100 },
      { op: '%>', column: 'Actual', compareTo: 'Planned', value: 15 },
      { resolver },
    ),
    true,
  );
  assert.equal(
    evaluateNode(
      { Actual: 110, Planned: 100 },
      { op: '%>', column: 'Actual', compareTo: 'Planned', value: 15 },
      { resolver },
    ),
    false,
  );
});

test('column resolver fuzzy matches "PM" to "Project Manager"', () => {
  const resolver = r(['Project Manager', 'Project No']);
  assert.equal(resolver.resolve('Project Manager'), 'Project Manager');
  assert.equal(resolver.resolve('project_manager'), 'Project Manager');
  assert.equal(resolver.resolve('ProjectManager'), 'Project Manager');
});

test('and/or composition', () => {
  const resolver = r(['A', 'B']);
  const node = {
    op: 'and' as const,
    children: [
      { op: '>' as const, column: 'A', value: 10 },
      { op: 'isBlank' as const, column: 'B' },
    ],
  };
  assert.equal(evaluateNode({ A: 20, B: '' }, node, { resolver }), true);
  assert.equal(evaluateNode({ A: 5, B: '' }, node, { resolver }), false);
  assert.equal(evaluateNode({ A: 20, B: 'set' }, node, { resolver }), false);
});

test('depth >2 throws', () => {
  const resolver = r(['A']);
  const deep = {
    op: 'and' as const,
    children: [
      {
        op: 'and' as const,
        children: [
          {
            op: 'and' as const,
            children: [{ op: '>' as const, column: 'A', value: 0 }],
          },
        ],
      },
    ],
  };
  assert.throws(() => evaluateNode({ A: 1 }, deep, { resolver }), /nesting depth/);
});

test('unknown column collected, returns false', () => {
  const resolver = r(['Real']);
  const unknownColumns = new Set<string>();
  const result = evaluateNode(
    { Real: 1 },
    { op: 'isBlank', column: 'Imaginary' },
    { resolver, unknownColumns },
  );
  assert.equal(result, false);
  assert.ok(unknownColumns.has('Imaginary'));
});
