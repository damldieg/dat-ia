import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthWindow, parseBudgetConfig, toBudgetsDTO, type LoadedBudgetConfig } from './budgets.ts';
import type { ModelUsageRow } from './store.ts';

function usageRow(overrides: Partial<ModelUsageRow> & { model_key: string }): ModelUsageRow {
  return {
    sessions: 1,
    cost: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_reasoning: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    ...overrides,
  };
}

function loaded(config: LoadedBudgetConfig['config']): LoadedBudgetConfig {
  return { config, status: 'ok', message: null };
}

test('parseBudgetConfig accepts limits per model, a default and a total', () => {
  const result = parseBudgetConfig(
    JSON.stringify({
      totalMonthlyUsd: 60,
      defaultMonthlyUsd: 5,
      models: {
        'opencode-go/gpt-6-luna': { monthlyUsd: 25 },
        'opencode/mimo-v2.6-flash-free': { monthlyTokens: 50_000_000 },
      },
    }),
  );
  assert.ok(result.ok);
  assert.deepEqual(result.config, {
    totalMonthlyUsd: 60,
    defaultMonthlyUsd: 5,
    models: {
      'opencode-go/gpt-6-luna': { monthlyUsd: 25 },
      'opencode/mimo-v2.6-flash-free': { monthlyTokens: 50_000_000 },
    },
  });
});

test('parseBudgetConfig treats null and missing limits as unset and ignores unknown keys', () => {
  const result = parseBudgetConfig(
    JSON.stringify({
      totalMonthlyUsd: null,
      note: 'ignored',
      models: { 'a/b': { monthlyUsd: null }, 'c/d': { monthlyUsd: 2, comment: 'ignored' } },
    }),
  );
  assert.ok(result.ok);
  assert.deepEqual(result.config, { models: { 'c/d': { monthlyUsd: 2 } } });
  assert.deepEqual(parseBudgetConfig('{}'), { ok: true, config: { models: {} } });
});

test('parseBudgetConfig rejects malformed files with the offending field', () => {
  const cases: [string, RegExp][] = [
    ['{ not json', /Not valid JSON/],
    ['[]', /must contain a JSON object/],
    ['{"totalMonthlyUsd": "60"}', /totalMonthlyUsd must be a positive number/],
    ['{"defaultMonthlyUsd": 0}', /defaultMonthlyUsd must be a positive number/],
    ['{"models": []}', /models must be an object/],
    ['{"models": {"a/b": 10}}', /models\["a\/b"\] must be an object/],
    ['{"models": {"a/b": {"monthlyTokens": -1}}}', /models\["a\/b"\]\.monthlyTokens must be a positive number/],
  ];
  for (const [text, pattern] of cases) {
    const result = parseBudgetConfig(text);
    assert.equal(result.ok, false, `expected a rejection for ${text}`);
    if (!result.ok) assert.match(result.message, pattern);
  }
});

test('monthWindow covers the calendar month in local time, end exclusive', () => {
  const october = monthWindow(2026, 10);
  assert.equal(october.key, '2026-10');
  assert.equal(october.from, new Date(2026, 9, 1).getTime());
  assert.equal(october.to, new Date(2026, 10, 1).getTime());
  assert.equal(monthWindow(2026, 12).to, new Date(2027, 0, 1).getTime());
});

test('a model entry wins over the default, and USD wins over tokens', () => {
  const window = monthWindow(2026, 10);
  const dto = toBudgetsDTO({
    window,
    usage: [
      usageRow({ model_key: 'p/own', cost: 4, tokens_input: 100, tokens_output: 50 }),
      usageRow({ model_key: 'p/both', cost: 1, tokens_input: 900, tokens_output: 100 }),
      usageRow({ model_key: 'p/fallback', cost: 12 }),
    ],
    sessionsWithoutModel: 0,
    loaded: loaded({
      defaultMonthlyUsd: 10,
      models: { 'p/own': { monthlyUsd: 8 }, 'p/both': { monthlyUsd: 2, monthlyTokens: 500 } },
    }),
    configPath: '/tmp/budgets.json',
    now: window.from + (window.to - window.from) / 4,
  });

  const byKey = new Map(dto.models.map((model) => [model.modelKey, model.budget]));
  assert.deepEqual(byKey.get('p/own'), { unit: 'usd', limit: 8, used: 4, ratio: 0.5, source: 'model' });
  assert.deepEqual(byKey.get('p/both'), { unit: 'usd', limit: 2, used: 1, ratio: 0.5, source: 'model' });
  assert.deepEqual(byKey.get('p/fallback'), { unit: 'usd', limit: 10, used: 12, ratio: 1.2, source: 'default' });
  assert.equal(dto.models[0]?.modelKey, 'p/fallback', 'the model over budget sorts first');
  assert.equal(dto.total.cost, 17);
  assert.equal(dto.total.budget, null);
  assert.equal(dto.month.isCurrent, true);
  assert.equal(dto.month.elapsedRatio, 0.25);
});
