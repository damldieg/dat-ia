import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCostStatus, toModelRef, toSessionDTO, toSummaryDTO } from './dto.ts';
import type { SessionRow, SummaryRow } from './store.ts';

const rowFixture: SessionRow = {
  id: 'ses_fixture0001',
  parent_id: null,
  project_id: 'project-1',
  directory: '/Users/dev/workspace/app',
  title: 'Inspect dashboard wiring',
  agent: 'general',
  model_json: '{"id":"mimo-v2.6-flash-free","providerID":"opencode"}',
  model_key: 'opencode/mimo-v2.6-flash-free',
  time_created: 1_790_000_000_000,
  time_updated: 1_790_000_100_000,
  cost: 0,
  tokens_input: 100,
  tokens_output: 50,
  tokens_reasoning: 0,
  tokens_cache_read: 200,
  tokens_cache_write: 0,
  child_count: 2,
  project_name: null,
  project_worktree: '/Users/dev/workspace/app',
};

test('toModelRef parses a registered model and rejects malformed input', () => {
  assert.deepEqual(toModelRef(rowFixture.model_json), {
    id: 'mimo-v2.6-flash-free',
    providerId: 'opencode',
    variant: null,
  });
  assert.deepEqual(
    toModelRef('{"id":"gpt-5.6-luna","providerID":"opencode-go","variant":"medium"}'),
    { id: 'gpt-5.6-luna', providerId: 'opencode-go', variant: 'medium' },
  );
  assert.equal(toModelRef(null), null);
  assert.equal(toModelRef('not json'), null);
  assert.equal(toModelRef('{"providerID":"opencode-go"}'), null, 'missing model id is not registered');
  assert.equal(toModelRef('"just a string"'), null);
});

test('toCostStatus separates registered zero from unavailable', () => {
  const registered = toModelRef(rowFixture.model_json);
  assert.deepEqual(toCostStatus(registered, 0), { status: 'known', value: 0 });
  assert.deepEqual(toCostStatus(registered, 1.25), { status: 'known', value: 1.25 });
  assert.deepEqual(toCostStatus(null, 0), { status: 'unavailable', reason: 'no-registered-model' });
});

test('toSessionDTO returns only allowlisted fields', () => {
  const dto = toSessionDTO({ ...rowFixture, project_name: 'dat-ia' });
  const expectedKeys = [
    'agent',
    'childCount',
    'cost',
    'directory',
    'id',
    'model',
    'modelKey',
    'parentId',
    'projectId',
    'projectLabel',
    'timeCreated',
    'timeUpdated',
    'title',
    'tokens',
  ];
  assert.deepEqual(Object.keys(dto).sort(), expectedKeys);
  assert.equal(dto.projectLabel, 'dat-ia');
  assert.deepEqual(dto.tokens, {
    input: 100,
    output: 50,
    reasoning: 0,
    cacheRead: 200,
    cacheWrite: 0,
  });
});

test('projectLabel falls back to the worktree basename', () => {
  const dto = toSessionDTO({ ...rowFixture, project_name: null });
  assert.equal(dto.projectLabel, 'app');
  const noWorktree = toSessionDTO({ ...rowFixture, project_name: ' ', project_worktree: null });
  assert.equal(noWorktree.projectLabel, 'app', 'directory basename is the last resort');
});

test('toSessionDTO marks sessions without a registered model as unknown cost', () => {
  const dto = toSessionDTO({ ...rowFixture, model_json: null, model_key: null, cost: 0 });
  assert.deepEqual(dto.cost, { status: 'unavailable', reason: 'no-registered-model' });
  assert.equal(dto.model, null);
});

test('toSummaryDTO reports registered totals and unknown-cost counts', () => {
  const summaryRow: SummaryRow = {
    total: 5,
    roots: 3,
    cost_unavailable: 1,
    cost_known_total: 0.75,
    cost_zero: 2,
    cost_positive: 2,
    tokens_input: 1000,
    tokens_output: 400,
    tokens_reasoning: 10,
    tokens_cache_read: 5000,
    tokens_cache_write: 0,
    earliest: 1_790_000_000_000,
    latest: 1_790_000_500_000,
  };

  const dto = toSummaryDTO(summaryRow, {
    agents: [{ value: 'general', count: 4 }],
    models: [{ value: 'opencode/mimo-v2.6-flash-free', count: 3 }],
    projects: [{ id: 'project-1', name: null, worktree: '/Users/dev/workspace/app', count: 5 }],
  });

  assert.equal(dto.sessions.total, 5);
  assert.equal(dto.sessions.roots, 3);
  assert.equal(dto.sessions.children, 2);
  assert.equal(dto.cost.knownTotal, 0.75);
  assert.equal(dto.cost.knownSessions, 4);
  assert.equal(dto.cost.zeroSessions, 2);
  assert.equal(dto.cost.unavailableSessions, 1);
  assert.equal(dto.timeRange?.earliest, 1_790_000_000_000);
  assert.deepEqual(dto.facets.agents, [{ value: 'general', label: 'general', count: 4 }]);
  assert.equal(dto.facets.projects[0]?.label, 'app');
});
