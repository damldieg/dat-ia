import type { AgentRollupDTO, TaskDTO } from '../../shared/types';
import { formatDateTime, formatRelativeTime, formatTokens, modelLabel, rollupCost, tokenTotal } from '../lib/format';
import { CostValue } from './CostValue';

interface TaskTableProps {
  tasks: TaskDTO[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Agent groups shown inline before collapsing the rest into "+n more". */
const MAX_AGENT_CHIPS = 4;

export function agentName(agent: string | null): string {
  return agent ?? 'no agent';
}

function AgentChips({ agents }: { agents: AgentRollupDTO[] }) {
  const shown = agents.slice(0, MAX_AGENT_CHIPS);
  const hidden = agents.length - shown.length;
  return (
    <ul className="chips" aria-label="Subagent calls by agent">
      {shown.map((entry) => (
        <li key={entry.agent ?? ''} className="chip">
          {agentName(entry.agent)}
          <span className="chip__count">×{entry.calls}</span>
        </li>
      ))}
      {hidden > 0 ? <li className="chip chip--more">+{hidden} more</li> : null}
    </ul>
  );
}

/**
 * One row per task: a root (orchestrator) session with every subagent session
 * below it folded in. Subagent sessions never get a row of their own; they are
 * classified by agent here and listed one by one in the task modal.
 */
export function TaskTable({ tasks, total, selectedId, onSelect }: TaskTableProps) {
  return (
    <div className="table-wrap">
      <table className="sessions tasks">
        <caption className="visually-hidden">
          {tasks.length} of {total} tasks, newest activity first. Select a task to see its subagent calls.
        </caption>
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Project</th>
            <th scope="col">Orchestrator</th>
            <th scope="col">Subagents</th>
            <th scope="col">Last activity</th>
            <th scope="col" className="is-numeric">
              Tokens
            </th>
            <th scope="col" className="is-numeric">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const { session } = task;
            return (
              <tr
                key={session.id}
                className={session.id === selectedId ? 'is-selected' : undefined}
                data-testid="task-row"
                onClick={() => onSelect(session.id)}
              >
                <td className="sessions__title">
                  <button
                    type="button"
                    className="link-button"
                    aria-haspopup="dialog"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(session.id);
                    }}
                  >
                    {session.title?.trim() || 'Untitled session'}
                  </button>
                  <span className="sessions__id">{session.id}</span>
                </td>
                <td>{session.projectLabel}</td>
                <td>
                  {session.agent ?? '—'}
                  <span className="sessions__model tasks__sub" title={session.model ? undefined : 'No model registered'}>
                    {modelLabel(session.model, '—')}
                  </span>
                </td>
                <td>
                  {task.subagentCalls > 0 ? (
                    <>
                      <span className="tasks__calls">
                        {task.subagentCalls} {task.subagentCalls === 1 ? 'call' : 'calls'}
                      </span>
                      <AgentChips agents={task.agents} />
                    </>
                  ) : (
                    <span className="tasks__none">—</span>
                  )}
                </td>
                <td title={formatDateTime(task.lastActivity)}>{formatRelativeTime(task.lastActivity)}</td>
                <td className="is-numeric">{formatTokens(tokenTotal(task.total.tokens))}</td>
                <td className="is-numeric">
                  <CostValue cost={rollupCost(task.total)} />
                  {task.subagentCalls > 0 ? (
                    <span className="tasks__sub">
                      subagents <CostValue cost={rollupCost(task.subagents)} />
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
