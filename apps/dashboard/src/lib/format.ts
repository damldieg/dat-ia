import type { CostStatus, SessionDTO, TokenUsage, UsageRollup } from '../../shared/types';

/** `—` for unavailable, never a fabricated zero. */
export function formatCost(cost: CostStatus): string {
  if (cost.status === 'unavailable') return '—';
  const value = cost.value;
  if (value === 0) return '$0.00';
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function costLabel(cost: CostStatus): string {
  if (cost.status === 'unavailable') return 'Cost not registered for this session';
  if (cost.value === 0) return 'Registered cost: $0.00 (free model or no usage yet)';
  return `Registered cost: $${cost.value}`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

export function formatTokenUsage(tokens: TokenUsage): string {
  return `${formatTokens(tokens.input)} in · ${formatTokens(tokens.output)} out`;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(ms: number): string {
  return dateTimeFormatter.format(new Date(ms));
}

const shortDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** Date and time without the year, for dense tables (pair it with a full `formatDateTime` tooltip). */
export function formatShortDateTime(ms: number): string {
  return shortDateTimeFormatter.format(new Date(ms));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - ms);
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  return `${Math.floor(delta / DAY)}d ago`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Cost of a rolled-up set of sessions. `unavailable` when no session in the
 * set has a registered cost (including an empty set), never a fabricated zero.
 */
export function rollupCost(usage: UsageRollup): CostStatus {
  if (usage.costKnownSessions === 0) return { status: 'unavailable', reason: 'no-registered-model' };
  return { status: 'known', value: usage.cost };
}

/** Input + output tokens: the single "tokens" figure used across the dashboard. */
export function tokenTotal(tokens: TokenUsage): number {
  return tokens.input + tokens.output;
}

export function modelLabel(model: SessionDTO['model'], missing = 'No model registered'): string {
  if (!model) return missing;
  return `${model.providerId}/${model.id}${model.variant ? `#${model.variant}` : ''}`;
}

const SECOND = 1_000;

/** Compact elapsed time, e.g. `45s`, `12m 30s`, `2h 05m`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, ms);
  if (total < SECOND) return '<1s';
  if (total < MINUTE) return `${Math.floor(total / SECOND)}s`;
  if (total < HOUR) {
    const seconds = Math.floor((total % MINUTE) / SECOND);
    return `${Math.floor(total / MINUTE)}m ${String(seconds).padStart(2, '0')}s`;
  }
  const minutes = Math.floor((total % HOUR) / MINUTE);
  return `${Math.floor(total / HOUR)}h ${String(minutes).padStart(2, '0')}m`;
}

/** Money for budget lines: two decimals, with a floor marker for tiny non-zero amounts. */
export function formatMoney(value: number): string {
  if (value > 0 && value < 0.01) return '<$0.01';
  return `$${value.toFixed(2)}`;
}

/** Whole percent; ratios are 0..1 and may exceed 1 (over budget). */
export function formatPercent(ratio: number): string {
  if (ratio > 0 && ratio < 0.01) return '<1%';
  return `${Math.round(ratio * 100)}%`;
}

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

/** `2026-10` -> `October 2026` (in the browser's locale). */
export function formatMonth(key: string): string {
  const [year, month] = key.split('-').map((part) => Number.parseInt(part, 10));
  if (!year || !month) return key;
  return monthFormatter.format(new Date(year, month - 1, 1));
}

/** Moves a `YYYY-MM` key by a number of months (negative = back). */
export function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split('-').map((part) => Number.parseInt(part, 10));
  if (!year || !month) return key;
  const date = new Date(year, month - 1 + delta, 1);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
