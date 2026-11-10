import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  billingWindow,
  currentBillingWindow,
  loadLimitSnapshot,
  monthWindow,
  parseBudgetConfig,
  toBudgetsDTO,
  type LoadedBudgetConfig,
  type LoadedLimitSnapshot,
  type PlanModelLimit,
} from './budgets.ts';
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

const NO_SNAPSHOT: LoadedLimitSnapshot = { snapshot: null, status: 'missing', message: null };

/** A snapshot where both plans share the same ids (as the bundled snapshot does). */
function snapshotOf(models: Record<string, PlanModelLimit>): LoadedLimitSnapshot {
  return {
    status: 'ok',
    message: null,
    snapshot: {
      source: 'https://opencode.ai/docs/go/',
      capturedAt: '2026-10-08',
      plans: {
        go: { label: 'OpenCode Go', models },
        'go-plus': { label: 'OpenCode Go Plus', models },
      },
    },
  };
}

function modelRow(
  modelKey: string,
  input: {
    config: LoadedBudgetConfig['config'];
    snapshot?: LoadedLimitSnapshot;
    cost?: number;
  },
) {
  const dto = toBudgetsDTO({
    window: monthWindow(2026, 10),
    usage: [usageRow({ model_key: modelKey, cost: input.cost ?? 0 })],
    recent5h: [],
    recent7d: [],
    sessionsWithoutModel: 0,
    loaded: loaded(input.config),
    snapshot: input.snapshot ?? NO_SNAPSHOT,
    configPath: '/tmp/budgets.json',
    now: new Date(2026, 9, 10).getTime(),
  });
  return dto.models.find((model) => model.modelKey === modelKey);
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
    recent5h: [],
    recent7d: [],
    sessionsWithoutModel: 0,
    loaded: loaded({
      defaultMonthlyUsd: 10,
      models: { 'p/own': { monthlyUsd: 8 }, 'p/both': { monthlyUsd: 2, monthlyTokens: 500 } },
    }),
    snapshot: NO_SNAPSHOT,
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

test('parseBudgetConfig accepts a plan and a billing day', () => {
  const result = parseBudgetConfig(JSON.stringify({ plan: 'go-plus', billingDay: 31, models: {} }));
  assert.ok(result.ok);
  assert.equal(result.config.plan, 'go-plus');
  assert.equal(result.config.billingDay, 31);
  const none = parseBudgetConfig(JSON.stringify({ plan: null, billingDay: null }));
  assert.ok(none.ok);
  assert.equal(none.config.plan, undefined);
  assert.equal(none.config.billingDay, undefined);
});

test('parseBudgetConfig rejects an unknown plan with the offending field', () => {
  for (const text of ['{"plan": "pro"}', '{"plan": 5}']) {
    const result = parseBudgetConfig(text);
    assert.equal(result.ok, false, `expected a rejection for ${text}`);
    if (!result.ok) assert.match(result.message, /plan must be "go", "go-plus" or null/);
  }
});

test('parseBudgetConfig ignores an invalid billing day instead of failing', () => {
  for (const billingDay of [0, 32, 15.5, '15', true]) {
    const result = parseBudgetConfig(JSON.stringify({ billingDay }));
    assert.ok(result.ok, `billingDay ${String(billingDay)} must not invalidate the file`);
    assert.equal(result.config.billingDay, undefined);
  }
});

test('loadLimitSnapshot never throws and reports missing and invalid snapshots', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'limits-'));
  try {
    const missing = loadLimitSnapshot(path.join(dir, 'nope.json'));
    assert.deepEqual(missing, { snapshot: null, status: 'missing', message: null });

    const brokenPath = path.join(dir, 'broken.json');
    writeFileSync(brokenPath, '{ not json');
    const broken = loadLimitSnapshot(brokenPath);
    assert.equal(broken.status, 'invalid');
    assert.equal(broken.snapshot, null);
    assert.match(broken.message ?? '', /Not valid JSON/);

    const badLimitPath = path.join(dir, 'bad-limit.json');
    writeFileSync(
      badLimitPath,
      JSON.stringify({ plans: { go: { label: 'OpenCode Go', models: { 'mimo-v2.6-pro': { monthlyUsd: -1 } } } } }),
    );
    const badLimit = loadLimitSnapshot(badLimitPath);
    assert.equal(badLimit.status, 'invalid');
    assert.match(badLimit.message ?? '', /monthlyUsd must be a positive number/);

    const missingPlanPath = path.join(dir, 'missing-plan.json');
    writeFileSync(missingPlanPath, JSON.stringify({ plans: { go: { label: 'OpenCode Go', models: {} } } }));
    assert.match(loadLimitSnapshot(missingPlanPath).message ?? '', /plans\["go-plus"\]/);

    const okPath = path.join(dir, 'ok.json');
    writeFileSync(okPath, JSON.stringify(snapshotOf({ 'mimo-v2.6-pro': { monthlyUsd: 15 } }).snapshot));
    const ok = loadLimitSnapshot(okPath);
    assert.equal(ok.status, 'ok');
    assert.deepEqual(ok.snapshot?.plans.go.models['mimo-v2.6-pro'], { monthlyUsd: 15 });
    assert.equal(ok.snapshot?.plans.go.label, 'OpenCode Go');
    assert.equal(ok.snapshot?.source, 'https://opencode.ai/docs/go/');
    assert.equal(ok.snapshot?.capturedAt, '2026-10-08');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a plan limit applies to opencode-go models with no manual entry', () => {
  const model = modelRow('opencode-go/mimo-v2.6-pro', {
    config: { plan: 'go', models: {} },
    snapshot: snapshotOf({ 'mimo-v2.6-pro': { monthlyUsd: 15 } }),
    cost: 4,
  });
  assert.deepEqual(model?.budget, { unit: 'usd', limit: 15, used: 4, ratio: 4 / 15, source: 'go' });
  assert.deepEqual(model?.plan, { id: 'go', monthlyUsd: 15 }, 'plan.monthlyUsd is the snapshot limit and equals budget.limit');
});

test('the go-plus plan resolves from the same snapshot ids', () => {
  const model = modelRow('opencode-go/mimo-v2.6-pro', {
    config: { plan: 'go-plus', models: {} },
    snapshot: snapshotOf({ 'mimo-v2.6-pro': { monthlyUsd: 15 } }),
    cost: 4,
  });
  assert.deepEqual(model?.budget, { unit: 'usd', limit: 15, used: 4, ratio: 4 / 15, source: 'go-plus' });
  assert.deepEqual(model?.plan, { id: 'go-plus', monthlyUsd: 15 });
});

test('manual entries win over plan limits and over Unlimited', () => {
  const config = {
    plan: 'go' as const,
    models: {
      'opencode-go/mimo-v2.6-pro': { monthlyUsd: 20 },
      'opencode-go/longcat-2.5-preview-free': { monthlyTokens: 500 },
    },
  };
  const snapshot = snapshotOf({ 'mimo-v2.6-pro': { monthlyUsd: 15 }, 'longcat-2.5-preview-free': { unlimited: true } });

  const manual = modelRow('opencode-go/mimo-v2.6-pro', { config, snapshot, cost: 4 });
  assert.deepEqual(manual?.budget, { unit: 'usd', limit: 20, used: 4, ratio: 0.2, source: 'model' });
  assert.deepEqual(manual?.plan, { id: 'go', monthlyUsd: 15 }, 'plan still reports the snapshot limit');

  const onUnlimited = modelRow('opencode-go/longcat-2.5-preview-free', { config, snapshot });
  assert.deepEqual(onUnlimited?.budget, { unit: 'tokens', limit: 500, used: 0, ratio: 0, source: 'model' });
  assert.deepEqual(onUnlimited?.plan, { id: 'go', monthlyUsd: null });
});

test('Unlimited and models missing from the snapshot are terminal, never an assumed limit', () => {
  const config = { plan: 'go' as const, defaultMonthlyUsd: 10, models: {} };
  const snapshot = snapshotOf({ 'longcat-2.5-preview-free': { unlimited: true } });

  const unlimited = modelRow('opencode-go/longcat-2.5-preview-free', { config, snapshot, cost: 3 });
  assert.equal(unlimited?.budget, null);
  assert.deepEqual(unlimited?.plan, { id: 'go', monthlyUsd: null });

  const notInSnapshot = modelRow('opencode-go/minimax-m2.5', { config, snapshot, cost: 3 });
  assert.equal(notInSnapshot?.budget, null, 'the default never applies to an opencode-go model under a plan');
  assert.equal(notInSnapshot?.plan, null);

  const other = modelRow('other/model', { config, snapshot, cost: 3 });
  assert.deepEqual(other?.budget, { unit: 'usd', limit: 10, used: 3, ratio: 0.3, source: 'default' });
  assert.equal(other?.plan, null, 'a non-opencode-go key never matches the snapshot');
});

test('a missing or invalid snapshot degrades every opencode-go model to "No budget set"', () => {
  const config = { plan: 'go' as const, defaultMonthlyUsd: 10, models: {} };
  const invalid: LoadedLimitSnapshot = { snapshot: null, status: 'invalid', message: 'Not valid JSON' };
  for (const snapshot of [NO_SNAPSHOT, invalid]) {
    const planned = modelRow('opencode-go/mimo-v2.6-pro', { config, snapshot, cost: 4 });
    assert.equal(planned?.budget, null, `terminal under ${snapshot.status} snapshot`);
    assert.equal(planned?.plan, null);

    const other = modelRow('other/model', { config, snapshot, cost: 4 });
    assert.deepEqual(other?.budget, { unit: 'usd', limit: 10, used: 4, ratio: 0.4, source: 'default' }, 'other providers keep the default');
  }
});

test('billingWindow anchors the cycle on billingDay, end exclusive', () => {
  const cycle = billingWindow(2026, 9, 15);
  assert.equal(cycle.key, '2026-09');
  assert.equal(cycle.from, new Date(2026, 8, 15).getTime());
  assert.equal(cycle.to, new Date(2026, 9, 15).getTime());
  assert.deepEqual(billingWindow(2026, 9), monthWindow(2026, 9), 'without a billing day the calendar month is unchanged');
});

test('billingDay 31 clamps to the last day of short months', () => {
  const january = billingWindow(2026, 1, 31);
  assert.equal(january.from, new Date(2026, 0, 31).getTime());
  assert.equal(january.to, new Date(2026, 1, 28).getTime(), 'February 2026 ends on the 28th');
  assert.equal(billingWindow(2028, 1, 31).to, new Date(2028, 1, 29).getTime(), 'February 2028 ends on the 29th');
});

test('currentBillingWindow returns the cycle containing now, labelled by its start month', () => {
  assert.equal(currentBillingWindow(new Date(2026, 9, 14, 12).getTime(), 15).key, '2026-09');
  assert.equal(currentBillingWindow(new Date(2026, 9, 15, 0).getTime(), 15).key, '2026-10');

  // Clamped boundary: the January cycle runs [Jan 31, Feb 28) with billingDay 31.
  const lateJan = currentBillingWindow(new Date(2026, 1, 27).getTime(), 31);
  assert.equal(lateJan.key, '2026-01');
  assert.equal(lateJan.from, new Date(2026, 0, 31).getTime());
  assert.equal(lateJan.to, new Date(2026, 1, 28).getTime());
  assert.equal(currentBillingWindow(new Date(2026, 1, 28).getTime(), 31).key, '2026-02');

  // December → January rollover: early January belongs to the December cycle.
  const earlyJan = currentBillingWindow(new Date(2026, 0, 5).getTime(), 15);
  assert.equal(earlyJan.key, '2025-12');
  assert.equal(earlyJan.from, new Date(2025, 11, 15).getTime());
  assert.equal(earlyJan.to, new Date(2026, 0, 15).getTime());
});

test('isCurrent and elapsedRatio follow the billing window', () => {
  const window = billingWindow(2026, 9, 15);
  const now = new Date(2026, 9, 1).getTime();
  const dto = toBudgetsDTO({
    window,
    usage: [],
    recent5h: [],
    recent7d: [],
    sessionsWithoutModel: 0,
    loaded: loaded({ models: {} }),
    snapshot: NO_SNAPSHOT,
    configPath: '/tmp/budgets.json',
    now,
  });
  assert.equal(dto.month.isCurrent, true);
  assert.equal(dto.month.elapsedRatio, (now - window.from) / (window.to - window.from));
});
