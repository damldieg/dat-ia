import type { BudgetLineDTO } from '../../shared/types';
import { formatMoney, formatTokens } from './format';

/** From this share of the limit on, a budget line is flagged as close to its limit. */
export const NEAR_LIMIT_RATIO = 0.8;

export type BudgetState = 'ok' | 'near' | 'over';

export function budgetState(ratio: number): BudgetState {
  if (ratio >= 1) return 'over';
  if (ratio >= NEAR_LIMIT_RATIO) return 'near';
  return 'ok';
}

/** Status is always icon + words, never colour alone. */
export const BUDGET_STATE_LABEL: Record<BudgetState, { icon: string; text: string }> = {
  ok: { icon: '✓', text: 'On track' },
  near: { icon: '▲', text: 'Near limit' },
  over: { icon: '✕', text: 'Over budget' },
};

export function formatBudgetAmount(unit: BudgetLineDTO['unit'], value: number): string {
  return unit === 'usd' ? formatMoney(value) : `${formatTokens(value)} tokens`;
}

/** `$4.20 of $20.00` / `8.6k of 10.0k tokens`. */
export function formatBudgetUsage(line: BudgetLineDTO): string {
  if (line.unit === 'usd') return `${formatMoney(line.used)} of ${formatMoney(line.limit)}`;
  return `${formatTokens(line.used)} of ${formatTokens(line.limit)} tokens`;
}

/** What is left, or by how much the limit is exceeded. */
export function formatBudgetRemaining(line: BudgetLineDTO): string {
  const delta = line.limit - line.used;
  if (delta >= 0) return `${formatBudgetAmount(line.unit, delta)} left`;
  return `${formatBudgetAmount(line.unit, -delta)} over`;
}
