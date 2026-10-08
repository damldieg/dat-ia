import type { BudgetLineDTO, BudgetsDTO } from '../../shared/types';
import {
  BUDGET_STATE_LABEL,
  budgetState,
  formatBudgetRemaining,
  formatBudgetUsage,
} from '../lib/budget';
import { formatMoney, formatMonth, formatPercent, formatTokens, plural, shiftMonth, tokenTotal } from '../lib/format';

interface BudgetPanelProps {
  budgets: BudgetsDTO;
  /** `undefined` selects the current month. */
  onMonthChange: (month: string | undefined) => void;
}

/**
 * Meter for one budget line. The fill carries the state (on track / near
 * limit / over budget) and the track is a lighter step of the same colour;
 * the state is also written out next to the bar, never colour alone. The
 * optional tick marks how much of the month has elapsed.
 */
function BudgetMeter({ label, line, pace }: { label: string; line: BudgetLineDTO; pace: number | null }) {
  const state = budgetState(line.ratio);
  const status = BUDGET_STATE_LABEL[state];
  const usage = formatBudgetUsage(line);
  return (
    <>
      <div
        className={`meter meter--${state}`}
        role="progressbar"
        aria-label={`${label} monthly budget`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(line.ratio * 100))}
        aria-valuetext={`${usage}, ${formatPercent(line.ratio)}, ${status.text}`}
        title={`${usage} · ${formatBudgetRemaining(line)}`}
      >
        <span className="meter__fill" style={{ width: `${Math.min(1, line.ratio) * 100}%` }} />
        {pace !== null ? <span className="meter__pace" style={{ left: `${pace * 100}%` }} /> : null}
      </div>
      <span className="budget__figures">
        <strong>{formatPercent(line.ratio)}</strong> · {usage}
        <span className="budget__remaining">{formatBudgetRemaining(line)}</span>
      </span>
      <span className={`budget__status budget__status--${state}`} data-state={state}>
        <span aria-hidden="true">{status.icon}</span> {status.text}
      </span>
    </>
  );
}

function ConfigNote({ budgets }: { budgets: BudgetsDTO }) {
  const { config } = budgets;
  const hasAnyBudget = budgets.total.budget !== null || budgets.models.some((model) => model.budget !== null);

  if (config.status === 'invalid') {
    return (
      <p className="card__warning" role="alert">
        The budgets file could not be used, so no limits are shown: {config.message} — <code>{config.path}</code>
      </p>
    );
  }
  if (config.status === 'missing') {
    return (
      <p className="budget__note" data-testid="budget-setup">
        No budgets configured yet. Copy <code>budgets.example.json</code> to <code>{config.path}</code>, set your monthly
        limits per model and press Refresh — the bars appear here.
      </p>
    );
  }
  if (!hasAnyBudget) {
    return (
      <p className="budget__note" data-testid="budget-setup">
        <code>{config.path}</code> has no limits set. Add <code>monthlyUsd</code> or <code>monthlyTokens</code> per model
        and press Refresh.
      </p>
    );
  }
  return null;
}

/**
 * Month-to-date usage per model against the monthly budgets from the local
 * budgets file. Usage is the registered cost (or tokens) of every session,
 * orchestrator and subagents alike, whose last activity falls in the month.
 */
export function BudgetPanel({ budgets, onMonthChange }: BudgetPanelProps) {
  const { month, total, models } = budgets;
  const pace = month.isCurrent ? month.elapsedRatio : null;
  const hasBudgetLines = total.budget !== null || models.some((model) => model.budget !== null);

  return (
    <section className="budget" aria-labelledby="budget-title">
      <header className="budget__header">
        <div>
          <h2 className="budget__title" id="budget-title">
            Monthly budget by model
          </h2>
          <p className="budget__subtitle">
            {formatMonth(month.key)}
            {month.isCurrent ? ' · month to date' : ''} · {formatMoney(total.cost)} registered across{' '}
            {plural(total.sessions, 'session', 'sessions')}
          </p>
        </div>
        <div className="budget__nav" role="group" aria-label="Month">
          <button type="button" onClick={() => onMonthChange(shiftMonth(month.key, -1))} aria-label="Previous month">
            ‹
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(shiftMonth(month.key, 1))}
            disabled={month.isCurrent}
            aria-label="Next month"
          >
            ›
          </button>
          <button type="button" onClick={() => onMonthChange(undefined)} disabled={month.isCurrent}>
            This month
          </button>
        </div>
      </header>

      <ConfigNote budgets={budgets} />

      {models.length === 0 && total.budget === null ? (
        <p className="detail__empty">No model usage registered in {formatMonth(month.key)}.</p>
      ) : (
        <ul className="budget__rows">
          {total.budget ? (
            <li className="budget__row budget__row--total" data-testid="budget-total">
              <span className="budget__name">
                All models
                <span className="budget__meta">overall monthly limit</span>
              </span>
              <BudgetMeter label="All models" line={total.budget} pace={pace} />
            </li>
          ) : null}
          {models.map((model) => (
            <li key={model.modelKey} className="budget__row" data-testid="budget-row">
              <span className="budget__name">
                <span className="budget__model">{model.modelKey}</span>
                <span className="budget__meta">
                  {plural(model.sessions, 'session', 'sessions')} · {formatTokens(tokenTotal(model.tokens))} tokens
                  {model.budget?.source === 'default' ? ' · default limit' : ''}
                </span>
              </span>
              {model.budget ? (
                <BudgetMeter label={model.modelKey} line={model.budget} pace={pace} />
              ) : (
                <>
                  <span className="budget__unset">No budget set</span>
                  <span className="budget__figures">
                    <strong>{formatMoney(model.cost)}</strong> spent
                  </span>
                  <span />
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="budget__legend">
        {hasBudgetLines && pace !== null ? (
          <>
            <span className="budget__pace-key" aria-hidden="true" /> {formatPercent(pace)} of the month elapsed — a bar
            past the tick is spending faster than an even pace.{' '}
          </>
        ) : null}
        Near limit from 80%.
        {budgets.sessionsWithoutModel > 0
          ? ` ${plural(budgets.sessionsWithoutModel, 'session', 'sessions')} this month ${
              budgets.sessionsWithoutModel === 1 ? 'has' : 'have'
            } no registered model and ${budgets.sessionsWithoutModel === 1 ? 'is' : 'are'} not counted.`
          : ''}
      </p>
    </section>
  );
}
