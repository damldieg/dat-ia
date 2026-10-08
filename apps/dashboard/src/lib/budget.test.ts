import { describe, expect, test } from 'vitest';
import type { BudgetLineDTO } from '../../shared/types';
import { LIMIT_ORIGIN_LABEL, budgetState, formatBudgetRemaining, formatBudgetUsage } from './budget';

const usd = (used: number, limit: number): BudgetLineDTO => ({ unit: 'usd', limit, used, ratio: used / limit, source: 'model' });

describe('budgetState', () => {
  test('is on track below 80%, near the limit from 80% and over from 100%', () => {
    expect(budgetState(0)).toBe('ok');
    expect(budgetState(0.79)).toBe('ok');
    expect(budgetState(0.8)).toBe('near');
    expect(budgetState(0.999)).toBe('near');
    expect(budgetState(1)).toBe('over');
    expect(budgetState(2.4)).toBe('over');
  });
});

describe('budget formatting', () => {
  test('formats USD usage and what is left or exceeded', () => {
    expect(formatBudgetUsage(usd(4.2, 20))).toBe('$4.20 of $20.00');
    expect(formatBudgetRemaining(usd(4.2, 20))).toBe('$15.80 left');
    expect(formatBudgetRemaining(usd(26, 25))).toBe('$1.00 over');
    expect(formatBudgetRemaining(usd(25, 25))).toBe('$0.00 left');
  });

  test('formats token budgets with compact counts', () => {
    const tokens: BudgetLineDTO = { unit: 'tokens', limit: 10_000, used: 8_584, ratio: 0.8584, source: 'model' };
    expect(formatBudgetUsage(tokens)).toBe('8.6k of 10.0k tokens');
    expect(formatBudgetRemaining(tokens)).toBe('1.4k tokens left');
  });
});

describe('LIMIT_ORIGIN_LABEL', () => {
  test('maps all five limit sources', () => {
    expect(LIMIT_ORIGIN_LABEL.model).toBe('manual');
    expect(LIMIT_ORIGIN_LABEL.default).toBe('default');
    expect(LIMIT_ORIGIN_LABEL.total).toBe('overall');
    expect(LIMIT_ORIGIN_LABEL.go).toBe('OpenCode Go');
    expect(LIMIT_ORIGIN_LABEL['go-plus']).toBe('OpenCode Go Plus');
  });
});
