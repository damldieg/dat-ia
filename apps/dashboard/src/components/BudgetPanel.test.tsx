import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BudgetPanel } from './BudgetPanel';
import { makeBudgets } from '../lib/testFixtures';
import type { BudgetsDTO, ModelBudgetDTO } from '../../shared/types';

function render(budgets: BudgetsDTO = makeBudgets()) {
  return renderToStaticMarkup(<BudgetPanel budgets={budgets} onMonthChange={() => undefined} />);
}

function model(overrides: Partial<ModelBudgetDTO> & { modelKey: string }): ModelBudgetDTO {
  return {
    sessions: 1,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    budget: null,
    plan: null,
    cost5h: 0,
    cost7d: 0,
    ...overrides,
  };
}

describe('BudgetPanel', () => {
  test('renders a progress bar per budgeted model with spend, limit and percentage', () => {
    const markup = render();
    expect(markup.match(/data-testid="budget-row"/g)).toHaveLength(4);
    expect(markup.match(/role="progressbar"/g)).toHaveLength(4); // 3 models + the overall line
    expect(markup).toContain('opencode-go/mimo-v2.6-pro');
    expect(markup).toContain('$8.50 of $10.00');
    expect(markup).toContain('<strong>85%</strong>');
    expect(markup).toContain('$1.50 left');
    expect(markup).toContain('width:85%');
  });

  test('states each budget status in words, not colour alone', () => {
    const markup = render();
    expect(markup).toMatch(/data-state="over">.*Over budget/);
    expect(markup).toMatch(/data-state="near">.*Near limit/);
    expect(markup).toMatch(/data-state="ok">.*On track/);
    expect(markup).toContain('meter--over');
    expect(markup).toContain('$1.00 over');
  });

  test('caps an over-budget bar at full width and keeps the real percentage', () => {
    const markup = render();
    expect(markup).toContain('<strong>104%</strong>');
    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).not.toContain('width:104%');
  });

  test('supports token budgets for models with no registered cost', () => {
    const markup = render();
    expect(markup).toContain('12.0M of 50.0M tokens');
    expect(markup).toContain('<strong>24%</strong>');
  });

  test('shows the overall line and the month pace only for the current month', () => {
    const current = render();
    expect(current).toContain('data-testid="budget-total"');
    expect(current).toContain('$37.50 of $60.00');
    expect(current).toContain('meter__pace');
    expect(current).toContain('25% of the month elapsed');
    expect(current).toContain('October 2026');

    const base = makeBudgets();
    const past = render({ ...base, month: { ...base.month, key: '2026-09', isCurrent: false, elapsedRatio: 1 } });
    expect(past).not.toContain('meter__pace');
    expect(past).not.toContain('of the month elapsed');
    expect(past).toContain('September 2026');
  });

  test('lists a model without a budget with its spend and no bar', () => {
    const markup = render();
    expect(markup).toContain('No budget set');
    expect(markup).toContain('<strong>$3.00</strong> spent');
  });

  test('explains how to configure budgets when the file is missing', () => {
    const base = makeBudgets();
    const markup = render({
      ...base,
      total: { ...base.total, budget: null },
      models: base.models.map((model) => ({ ...model, budget: null })),
      config: { ...base.config, status: 'missing' },
    });
    expect(markup).toContain('data-testid="budget-setup"');
    expect(markup).toContain('budgets.example.json');
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).toContain('<strong>$26.00</strong> spent');
  });

  test('reports an invalid budgets file instead of hiding it', () => {
    const base = makeBudgets();
    const markup = render({
      ...base,
      config: { ...base.config, status: 'invalid', message: 'totalMonthlyUsd must be a positive number' },
    });
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('totalMonthlyUsd must be a positive number');
  });

  test('mentions sessions that cannot be attributed to a model', () => {
    const markup = render(makeBudgets({ sessionsWithoutModel: 2 }));
    expect(markup).toContain('2 sessions this month have no registered model and are not counted.');
  });

  test('shows an empty state for a month with no usage and no budgets', () => {
    const base = makeBudgets();
    const markup = render({
      ...base,
      total: { ...base.total, sessions: 0, cost: 0, budget: null },
      models: [],
      config: { ...base.config, status: 'missing' },
    });
    expect(markup).toContain('No model usage registered in October 2026.');
  });

  test('labels every budgeted row with the origin of its limit', () => {
    const base = makeBudgets();
    const markup = render({
      ...base,
      models: [
        model({ modelKey: 'opencode-go/gpt-6-luna', budget: { unit: 'usd', limit: 25, used: 5, ratio: 0.2, source: 'model' } }),
        model({ modelKey: 'opencode-go/kimi-k3', budget: { unit: 'usd', limit: 15, used: 2, ratio: 2 / 15, source: 'default' } }),
        model({ modelKey: 'opencode-go/mimo-v2.6-pro', budget: { unit: 'usd', limit: 15, used: 1, ratio: 1 / 15, source: 'go' } }),
        model({ modelKey: 'opencode-go/glm-5.2', budget: { unit: 'usd', limit: 180, used: 1, ratio: 1 / 180, source: 'go-plus' } }),
      ],
    });
    expect(markup).toContain('· manual');
    expect(markup).toContain('· default');
    expect(markup).toContain('· OpenCode Go ·');
    expect(markup).toContain('· OpenCode Go Plus ·');
  });

  test('shows the rolling 5h and 7d cost sums on each row', () => {
    const base = makeBudgets();
    const markup = render({
      ...base,
      models: [model({ modelKey: 'opencode-go/gpt-6-luna', cost5h: 1.25, cost7d: 3.4 })],
    });
    expect(markup).toContain('5h $1.25 · 7d $3.40');
  });

  test('marks an unlimited Go plan model as Unlimited with its plan label', () => {
    const base = makeBudgets();
    const markup = render({
      ...base,
      total: { ...base.total, budget: null },
      models: [model({ modelKey: 'opencode-go/longcat-2.5-preview-free', plan: { id: 'go', monthlyUsd: null } })],
    });
    expect(markup).toContain('Unlimited · OpenCode Go');
    expect(markup).not.toContain('No budget set');
    expect(markup).not.toContain('role="progressbar"');
  });

  test('marks an unlimited Go Plus plan model with the Go Plus label, not the Go one', () => {
    const base = makeBudgets();
    const markup = render({
      ...base,
      total: { ...base.total, budget: null },
      models: [model({ modelKey: 'opencode-go/longcat-2.5-preview-free', plan: { id: 'go-plus', monthlyUsd: null } })],
    });
    expect(markup).toContain('Unlimited · OpenCode Go Plus');
    expect(markup).not.toContain('Unlimited · OpenCode Go<');
  });

  test('keeps the bar for a manual limit on an unlimited plan model', () => {
    const base = makeBudgets();
    const markup = render({
      ...base,
      total: { ...base.total, budget: null },
      models: [
        model({
          modelKey: 'opencode-go/longcat-2.5-preview-free',
          cost: 3,
          budget: { unit: 'usd', limit: 5, used: 3, ratio: 0.6, source: 'model' },
          plan: { id: 'go', monthlyUsd: null },
        }),
      ],
    });
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('· manual');
    expect(markup).not.toContain('Unlimited');
  });

  test('shows when the plan limits were captured, and hides it when the snapshot is not ok', () => {
    expect(render()).toContain('Plan limits captured 2026-10-08');
    const base = makeBudgets();
    const missing = render({
      ...base,
      snapshot: { source: null, capturedAt: null, status: 'missing', message: null },
    });
    expect(missing).not.toContain('Plan limits captured');
  });

  test('shows No budget set for an opencode-go model missing from the snapshot', () => {
    const base = makeBudgets();
    const markup = render({
      ...base,
      models: [model({ modelKey: 'opencode-go/minimax-m2.5', cost: 3 })],
    });
    expect(markup).toContain('No budget set');
    expect(markup).not.toContain('Unlimited');
  });
});
