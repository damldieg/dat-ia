import type { CostStatus, TokenUsage } from '../../shared/types';

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
