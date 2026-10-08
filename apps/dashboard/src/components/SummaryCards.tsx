import type { SummaryDTO } from '../../shared/types';
import { formatDateTime, formatTokens, plural } from '../lib/format';

/**
 * Aggregate summary. A task is a root (orchestrator) session; its subagent
 * sessions are counted as calls. Registered cost only: sessions without a
 * registered cost are counted separately and never added to the total.
 */
export function SummaryCards({ summary }: { summary: SummaryDTO }) {
  const { sessions, cost, tokens, timeRange } = summary;
  return (
    <section className="summary" aria-label="Summary">
      <article className="card">
        <h2 className="card__label">Tasks</h2>
        <p className="card__value" data-testid="task-count">
          {sessions.roots}
        </p>
        <p className="card__meta">
          {plural(sessions.children, 'subagent call', 'subagent calls')} · {plural(sessions.total, 'session', 'sessions')}{' '}
          in total
        </p>
      </article>

      <article className="card">
        <h2 className="card__label">Registered cost</h2>
        <p className="card__value" data-testid="known-cost">
          ${cost.knownTotal.toFixed(2)}
        </p>
        <p className="card__meta">
          {plural(cost.knownSessions, 'session', 'sessions')} registered ·{' '}
          {plural(cost.zeroSessions, 'session', 'sessions')} at $0.00
        </p>
        {cost.unavailableSessions > 0 ? (
          <p className="card__warning" data-testid="unavailable-cost">
            {plural(cost.unavailableSessions, 'session', 'sessions')} without registered cost (shown as —)
          </p>
        ) : null}
      </article>

      <article className="card">
        <h2 className="card__label">Tokens</h2>
        <p className="card__value">{formatTokens(tokens.input)}</p>
        <p className="card__meta">
          input · {formatTokens(tokens.output)} output · {formatTokens(tokens.cacheRead)} cache read
        </p>
      </article>

      <article className="card">
        <h2 className="card__label">Activity</h2>
        <p className="card__value card__value--small">
          {timeRange ? formatDateTime(timeRange.earliest) : '—'}
        </p>
        <p className="card__meta">
          {timeRange ? `through ${formatDateTime(timeRange.latest)}` : 'no sessions recorded'}
        </p>
      </article>
    </section>
  );
}
