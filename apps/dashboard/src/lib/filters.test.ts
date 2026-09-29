import { describe, expect, test } from 'vitest';
import {
  DEFAULT_FILTER,
  applyRange,
  fromDateTimeLocal,
  isFilterActive,
  presetRange,
  toDateTimeLocal,
} from './filters';

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

describe('presetRange', () => {
  test('all-time and custom presets add no bounds', () => {
    expect(presetRange('all', NOW)).toEqual({});
    expect(presetRange('custom', NOW)).toEqual({});
  });

  test('relative presets only bound the lower end', () => {
    expect(presetRange('24h', NOW)).toEqual({ from: NOW - 86_400_000 });
    expect(presetRange('7d', NOW)).toEqual({ from: NOW - 7 * 86_400_000 });
    expect(presetRange('30d', NOW)).toEqual({ from: NOW - 30 * 86_400_000 });
  });
});

describe('applyRange', () => {
  test('merges the window into the base filter and replaces stale bounds', () => {
    const base = { ...DEFAULT_FILTER, agent: 'general', from: 1 };
    const result = applyRange(base, { preset: '24h', from: NOW - 86_400_000 });
    expect(result.agent).toBe('general');
    expect(result.from).toBe(NOW - 86_400_000);
    expect(result.to).toBeUndefined();
  });

  test('custom ranges keep the user-selected bounds', () => {
    const result = applyRange(DEFAULT_FILTER, { preset: 'custom', from: 1000, to: 2000 });
    expect(result.from).toBe(1000);
    expect(result.to).toBe(2000);
  });

  test('all-time clears previous bounds', () => {
    const base = { ...DEFAULT_FILTER, from: 1, to: 2 };
    const result = applyRange(base, { preset: 'all' });
    expect(result.from).toBeUndefined();
    expect(result.to).toBeUndefined();
  });
});

describe('datetime-local conversion', () => {
  test('round-trips a timestamp in local time', () => {
    const ms = Date.UTC(2026, 0, 15, 8, 30);
    const value = toDateTimeLocal(ms);
    expect(fromDateTimeLocal(value)).toBe(Math.floor(ms / 60_000) * 60_000);
  });

  test('rejects malformed input instead of producing NaN', () => {
    expect(fromDateTimeLocal('')).toBeUndefined();
    expect(fromDateTimeLocal('not-a-date')).toBeUndefined();
  });
});

describe('isFilterActive', () => {
  test('is false for the default filter', () => {
    expect(isFilterActive(DEFAULT_FILTER)).toBe(false);
  });

  test('is true as soon as any dimension narrows the query', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, agent: 'build' })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_FILTER, model: 'opencode/x' })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_FILTER, project: 'p1' })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_FILTER, from: 1 })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_FILTER, children: 'only' })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_FILTER, children: 'include' })).toBe(false);
  });
});
