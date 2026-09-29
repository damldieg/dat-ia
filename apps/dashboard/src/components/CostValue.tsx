import type { CostStatus } from '../../shared/types';
import { costLabel, formatCost } from '../lib/format';

/**
 * Cost cell: a registered value, or `—` when no cost is registered.
 * `data-status` lets CSS and tests distinguish the two states.
 */
export function CostValue({ cost }: { cost: CostStatus }) {
  return (
    <span className={`cost cost--${cost.status}`} data-status={cost.status} title={costLabel(cost)}>
      {formatCost(cost)}
    </span>
  );
}
