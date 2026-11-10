import { useEffect, useRef } from 'react';
import type { SessionDTO, TaskDetailDTO, TaskDTO, UsageRollup } from '../../shared/types';
import {
  formatDateTime,
  formatDuration,
  formatPercent,
  formatShortDateTime,
  formatTokenUsage,
  formatTokens,
  modelLabel,
  plural,
  rollupCost,
  tokenTotal,
} from '../lib/format';
import { buildTree, flattenTree } from '../lib/tree';
import type { AsyncState } from '../lib/useAsync';
import { CostValue } from './CostValue';
import { ErrorPanel, LoadingPanel } from './StatusPanels';
import { agentName } from './TaskTable';

interface TaskModalProps {
  /** Task as listed in the table: shown at once while the calls load. */
  task: TaskDTO;
  /** Fresh detail for the task (its own rollup plus every subagent call). */
  detail: AsyncState<TaskDetailDTO | null>;
  onRetry: () => void;
  onClose: () => void;
}

interface BreakdownRow {
  key: string;
  label: string;
  hint: string;
  calls: number | null;
  usage: UsageRollup;
}

/**
 * Share of the task each row accounts for. Cost when the task has any
 * registered spend; tokens otherwise, so tasks run entirely on free models
 * still show where the work went.
 */
function shareBasis(task: TaskDTO): { unit: 'cost' | 'tokens'; total: number; of: (usage: UsageRollup) => number } {
  if (task.total.cost > 0) return { unit: 'cost', total: task.total.cost, of: (usage) => usage.cost };
  return { unit: 'tokens', total: tokenTotal(task.total.tokens), of: (usage) => tokenTotal(usage.tokens) };
}

function sessionUsage(session: SessionDTO): UsageRollup {
  const known = session.cost.status === 'known';
  return {
    cost: session.cost.status === 'known' ? session.cost.value : 0,
    costKnownSessions: known ? 1 : 0,
    costUnavailableSessions: known ? 0 : 1,
    tokens: session.tokens,
  };
}

function Breakdown({ task }: { task: TaskDTO }) {
  const basis = shareBasis(task);
  const rows: BreakdownRow[] = [
    {
      key: 'orchestrator',
      label: task.session.agent ?? 'orchestrator',
      hint: `Orchestrator (main session) · ${modelLabel(task.session.model)}`,
      calls: null,
      usage: sessionUsage(task.session),
    },
    ...task.agents.map((entry) => ({
      key: `agent:${entry.agent ?? ''}`,
      label: agentName(entry.agent),
      hint: entry.models.length > 0 ? entry.models.join(', ') : 'No model registered',
      calls: entry.calls,
      usage: entry.usage,
    })),
  ];

  return (
    <table className="sessions breakdown" data-testid="task-breakdown">
      <caption className="visually-hidden">Spend of this task by agent</caption>
      <thead>
        <tr>
          <th scope="col">Agent</th>
          <th scope="col" className="is-numeric">
            Calls
          </th>
          <th scope="col" className="is-numeric">
            Tokens
          </th>
          <th scope="col" className="is-numeric">
            Cost
          </th>
          <th scope="col">{basis.unit === 'cost' ? 'Share of cost' : 'Share of tokens'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const share = basis.total > 0 ? basis.of(row.usage) / basis.total : 0;
          return (
            <tr key={row.key}>
              <th scope="row" className="breakdown__agent">
                {row.label}
                <span className="sessions__model tasks__sub">{row.hint}</span>
              </th>
              <td className="is-numeric">{row.calls ?? '—'}</td>
              <td className="is-numeric" title={formatTokenUsage(row.usage.tokens)}>
                {formatTokens(tokenTotal(row.usage.tokens))}
              </td>
              <td className="is-numeric">
                <CostValue cost={rollupCost(row.usage)} />
              </td>
              <td className="breakdown__share">
                <span className="share" aria-hidden="true">
                  <span className="share__fill" style={{ width: `${Math.min(1, share) * 100}%` }} />
                </span>
                <span className="share__value">{formatPercent(share)}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Task total</th>
          <td className="is-numeric">{task.subagentCalls}</td>
          <td className="is-numeric" title={formatTokenUsage(task.total.tokens)}>
            {formatTokens(tokenTotal(task.total.tokens))}
          </td>
          <td className="is-numeric">
            <CostValue cost={rollupCost(task.total)} />
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}

function CallsTable({ root, calls }: { root: SessionDTO; calls: SessionDTO[] }) {
  // The tree is rooted at the orchestrator; its descendants are the calls, depth-first.
  const tree = buildTree([root, ...calls]);
  const rows = flattenTree(tree).filter((row) => row.session.id !== root.id);

  return (
    <div className="table-wrap">
      <table className="sessions calls" data-testid="task-calls">
        <caption className="visually-hidden">
          Subagent calls of this task. A call made by another subagent is listed under it, indented.
        </caption>
        <thead>
          <tr>
            <th scope="col">Subagent call</th>
            <th scope="col">Agent</th>
            <th scope="col">Model</th>
            <th scope="col">Started</th>
            <th scope="col" className="is-numeric" title="Last activity minus creation time of the subagent session">
              Duration
            </th>
            <th scope="col" className="is-numeric">
              Tokens
            </th>
            <th scope="col" className="is-numeric">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ session, depth }) => (
            <tr key={session.id} data-testid="call-row">
              <td className="sessions__title">
                <span className="calls__title" style={{ paddingLeft: `${Math.max(0, depth - 1) * 1.1}rem` }}>
                  {depth > 1 ? (
                    <span className="calls__nest" aria-hidden="true">
                      ↳{' '}
                    </span>
                  ) : null}
                  {session.title?.trim() || 'Untitled session'}
                </span>
                <span className="sessions__id" style={{ paddingLeft: `${Math.max(0, depth - 1) * 1.1}rem` }}>
                  {session.id}
                </span>
              </td>
              <td>{agentName(session.agent)}</td>
              <td className="sessions__model" title={session.model ? undefined : 'No model registered'}>
                {modelLabel(session.model, '—')}
              </td>
              <td title={formatDateTime(session.timeCreated)}>{formatShortDateTime(session.timeCreated)}</td>
              <td className="is-numeric">{formatDuration(session.timeUpdated - session.timeCreated)}</td>
              <td className="is-numeric" title={formatTokenUsage(session.tokens)}>
                {formatTokens(tokenTotal(session.tokens))}
              </td>
              <td className="is-numeric">
                <CostValue cost={session.cost} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Task detail as a modal dialog: what the orchestrator and each kind of
 * subagent spent, then every subagent call one by one. Native `<dialog>` gives
 * the focus trap, the backdrop and Esc-to-close.
 */
export function TaskModal({ task: listed, detail, onRetry, onClose }: TaskModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    // No cleanup on purpose: unmounting removes the dialog from the top layer, and calling
    // `close()` here would fire a `close` event that StrictMode's double effect run would
    // turn into an immediate `onClose`.
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const loaded = detail.status === 'ready' ? detail.data : null;
  const task = loaded?.task ?? listed;
  const root = task.session;
  const unregistered = task.total.costUnavailableSessions;

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="task-modal-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal__body">
        <header className="modal__header">
          <div>
            <h2 className="modal__title" id="task-modal-title">
              {root.title?.trim() || 'Untitled session'}
            </h2>
            <p className="detail__id">
              {root.id} · {root.projectLabel} · {root.directory}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close task detail">
            ✕
          </button>
        </header>

        <dl className="modal__stats">
          <div>
            <dt>Task cost</dt>
            <dd className="modal__stat">
              <CostValue cost={rollupCost(task.total)} />
            </dd>
            <dd className="modal__stat-meta">orchestrator + subagents</dd>
          </div>
          <div>
            <dt>Orchestrator</dt>
            <dd className="modal__stat">
              <CostValue cost={root.cost} />
            </dd>
            <dd className="modal__stat-meta">{formatTokenUsage(root.tokens)}</dd>
          </div>
          <div>
            <dt>Subagents</dt>
            <dd className="modal__stat">
              <CostValue cost={rollupCost(task.subagents)} />
            </dd>
            <dd className="modal__stat-meta">
              {plural(task.subagentCalls, 'call', 'calls')} · {formatTokenUsage(task.subagents.tokens)}
            </dd>
          </div>
          <div>
            <dt>Timeline</dt>
            <dd className="modal__stat modal__stat--small">{formatDuration(task.lastActivity - root.timeCreated)}</dd>
            <dd className="modal__stat-meta">
              {formatDateTime(root.timeCreated)} → {formatDateTime(task.lastActivity)}
            </dd>
          </div>
        </dl>

        {unregistered > 0 ? (
          <p className="card__warning">
            {plural(unregistered, 'session', 'sessions')} in this task {unregistered === 1 ? 'has' : 'have'} no
            registered cost (shown as —) and {unregistered === 1 ? 'is' : 'are'} not included in the totals.
          </p>
        ) : null}

        <h3 className="detail__subtitle">Spend by agent</h3>
        <div className="table-wrap">
          <Breakdown task={task} />
        </div>

        <h3 className="detail__subtitle">Subagent calls ({task.subagentCalls})</h3>
        {detail.status === 'loading' ? <LoadingPanel label="Loading subagent calls…" /> : null}
        {detail.status === 'error' ? <ErrorPanel message={detail.message} onRetry={onRetry} /> : null}
        {loaded && loaded.calls.length === 0 ? (
          <p className="detail__empty">The orchestrator did not call any subagent in this task.</p>
        ) : null}
        {loaded && loaded.calls.length > 0 ? <CallsTable root={root} calls={loaded.calls} /> : null}
      </div>
    </dialog>
  );
}
