import { describe, expect, test } from 'vitest';
import {
  costLabel,
  formatCost,
  formatDuration,
  formatMoney,
  formatMonth,
  formatPercent,
  formatRelativeTime,
  formatTokens,
  formatTokenUsage,
  modelLabel,
  plural,
  rollupCost,
  shiftMonth,
  tokenTotal,
} from './format';

describe('formatCost', () => {
  test('renders unavailable cost as an em dash, never as zero', () => {
    expect(formatCost({ status: 'unavailable', reason: 'no-registered-model' })).toBe('—');
  });

  test('renders a registered zero as $0.00', () => {
    expect(formatCost({ status: 'known', value: 0 })).toBe('$0.00');
  });

  test('keeps precision for small registered values and rounds large ones', () => {
    expect(formatCost({ status: 'known', value: 0.022052162 })).toBe('$0.0221');
    expect(formatCost({ status: 'known', value: 1.432567175 })).toBe('$1.43');
  });

  test('costLabel explains both states', () => {
    expect(costLabel({ status: 'known', value: 0 })).toMatch(/free model or no usage/);
    expect(costLabel({ status: 'unavailable', reason: 'no-registered-model' })).toBe(
      'Cost not registered for this session',
    );
  });
});

describe('formatTokens', () => {
  test('formats raw counts, thousands and millions', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(7585)).toBe('7.6k');
    expect(formatTokens(7_471_110)).toBe('7.5M');
  });

  test('formatTokenUsage shows both sides', () => {
    expect(formatTokenUsage({ input: 8562, output: 7585, reasoning: 0, cacheRead: 0, cacheWrite: 0 })).toBe(
      '8.6k in · 7.6k out',
    );
  });
});

describe('formatRelativeTime', () => {
  const now = 1_790_000_000_000;

  test('scales the unit to the elapsed time', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  test('never renders a negative age', () => {
    expect(formatRelativeTime(now + 60_000, now)).toBe('just now');
  });
});

describe('plural', () => {
  test('picks the singular form for one', () => {
    expect(plural(1, 'session', 'sessions')).toBe('1 session');
    expect(plural(0, 'session', 'sessions')).toBe('0 sessions');
  });
});

const TOKENS = { input: 1_200, output: 300, reasoning: 50, cacheRead: 9_000, cacheWrite: 0 };

describe('rollups', () => {
  test('rollupCost is unavailable when no session has a registered cost, never zero', () => {
    expect(rollupCost({ cost: 0, costKnownSessions: 0, costUnavailableSessions: 2, tokens: TOKENS })).toEqual({
      status: 'unavailable',
      reason: 'no-registered-model',
    });
    expect(rollupCost({ cost: 0, costKnownSessions: 0, costUnavailableSessions: 0, tokens: TOKENS }).status).toBe(
      'unavailable',
    );
  });

  test('rollupCost keeps a registered total, including a registered zero', () => {
    expect(rollupCost({ cost: 1.25, costKnownSessions: 3, costUnavailableSessions: 1, tokens: TOKENS })).toEqual({
      status: 'known',
      value: 1.25,
    });
    expect(rollupCost({ cost: 0, costKnownSessions: 1, costUnavailableSessions: 0, tokens: TOKENS })).toEqual({
      status: 'known',
      value: 0,
    });
  });

  test('tokenTotal is input plus output', () => {
    expect(tokenTotal(TOKENS)).toBe(1_500);
  });

  test('modelLabel joins provider, model and variant', () => {
    expect(modelLabel({ id: 'gpt-6-luna', providerId: 'opencode-go', variant: 'medium' })).toBe(
      'opencode-go/gpt-6-luna#medium',
    );
    expect(modelLabel({ id: 'mimo', providerId: 'opencode', variant: null })).toBe('opencode/mimo');
    expect(modelLabel(null)).toBe('No model registered');
    expect(modelLabel(null, '—')).toBe('—');
  });
});

describe('formatDuration', () => {
  test('formats seconds, minutes and hours compactly', () => {
    expect(formatDuration(0)).toBe('<1s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(150_000)).toBe('2m 30s');
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe('2h 05m');
    expect(formatDuration(-10)).toBe('<1s');
  });
});

describe('budget figures', () => {
  test('formatMoney uses two decimals and flags tiny amounts', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(0.004)).toBe('<$0.01');
    expect(formatMoney(12.345)).toBe('$12.35');
  });

  test('formatPercent rounds and can exceed 100%', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.004)).toBe('<1%');
    expect(formatPercent(0.625)).toBe('63%');
    expect(formatPercent(1.04)).toBe('104%');
  });

  test('shiftMonth moves across year boundaries', () => {
    expect(shiftMonth('2026-10', -1)).toBe('2026-09');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('nonsense', 1)).toBe('nonsense');
  });

  test('formatMonth names the month and year', () => {
    expect(formatMonth('2026-10')).toMatch(/2026/);
    expect(formatMonth('nonsense')).toBe('nonsense');
  });
});
