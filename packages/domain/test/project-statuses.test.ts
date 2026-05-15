import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProjectStatuses,
  globalResolvedFromStatuses,
  parseProjectStatuses,
  patchEngineStatus,
  recomputeAggregate,
} from '../src/project/projectStatuses.js';
import type { FunctionId } from '../src/project/functions.js';

test('parseProjectStatuses migrates legacy project map', () => {
  const raw = {
    'P-1': {
      projectNo: 'P-1',
      stage: 'open',
      feedback: '',
      history: [],
      updatedAt: '2026-01-01T00:00:00Z',
    },
  };
  const v = parseProjectStatuses(raw);
  assert.ok(v.byEngine['master-data']);
  assert.equal(v.aggregate.totalOpen, 1);
  assert.ok(v.legacyProjects?.['P-1']);
  assert.equal(v.legacyProjects?.['P-1']?.stage, 'open');
});

test('globalResolvedFromStatuses requires all non-na engines resolved', () => {
  const base = emptyProjectStatuses();
  const fid = 'master-data' as FunctionId;
  let s = patchEngineStatus(base, fid, { openCount: 1, status: 'open', lastSeenRunId: 'run-1' });
  assert.equal(globalResolvedFromStatuses(s), false);
  s = patchEngineStatus(s, fid, { openCount: 0, status: 'resolved', lastSeenRunId: 'run-1', resolvedAt: '2026-01-02T00:00:00Z' });
  assert.equal(globalResolvedFromStatuses(recomputeAggregate(s)), true);
});
