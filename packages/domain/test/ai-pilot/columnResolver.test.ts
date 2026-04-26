import test from 'node:test';
import assert from 'node:assert/strict';
import { ColumnResolver } from '../../src/ai-pilot/columnResolver.js';

test('exact match', () => {
  const r = new ColumnResolver(['Project Manager']);
  assert.equal(r.resolve('Project Manager'), 'Project Manager');
});

test('underscores, hyphens, dots normalized away', () => {
  const r = new ColumnResolver(['Project Manager']);
  assert.equal(r.resolve('project_manager'), 'Project Manager');
  assert.equal(r.resolve('project-manager'), 'Project Manager');
  assert.equal(r.resolve('project.manager'), 'Project Manager');
  assert.equal(r.resolve('ProjectManager'), 'Project Manager');
});

test('case insensitive', () => {
  const r = new ColumnResolver(['Email']);
  assert.equal(r.resolve('EMAIL'), 'Email');
  assert.equal(r.resolve('email'), 'Email');
});

test('returns undefined for unknown column', () => {
  const r = new ColumnResolver(['Project Manager']);
  assert.equal(r.resolve('Customer Name'), undefined);
});

test('suggest returns closest matches for typos', () => {
  const r = new ColumnResolver(['Project Manager', 'Project Name', 'Project No']);
  const suggestions = r.suggest('Project Mngr');
  assert.ok(suggestions.length > 0);
  assert.equal(suggestions[0], 'Project Manager');
});

test('empty input returns empty suggestions', () => {
  const r = new ColumnResolver(['A', 'B']);
  assert.deepEqual(r.suggest(''), []);
});
