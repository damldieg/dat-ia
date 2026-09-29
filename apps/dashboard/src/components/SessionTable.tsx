import type { SessionDTO } from '../../shared/types';
import { formatDateTime, formatRelativeTime, formatTokens } from '../lib/format';
import { CostValue } from './CostValue';

interface SessionTableProps {
  sessions: SessionDTO[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function modelLabel(session: SessionDTO): string {
  if (!session.model) return '—';
  return `${session.model.providerId}/${session.model.id}${session.model.variant ? `#${session.model.variant}` : ''}`;
}

export function SessionTable({ sessions, total, selectedId, onSelect }: SessionTableProps) {
  return (
    <div className="table-wrap">
      <table className="sessions">
        <caption className="visually-hidden">
          {sessions.length} of {total} sessions, newest activity first
        </caption>
        <thead>
          <tr>
            <th scope="col">Session</th>
            <th scope="col">Agent</th>
            <th scope="col">Model</th>
            <th scope="col">Project</th>
            <th scope="col">Updated</th>
            <th scope="col">Tokens</th>
            <th scope="col">Cost</th>
            <th scope="col">Children</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr
              key={session.id}
              className={session.id === selectedId ? 'is-selected' : undefined}
              data-testid="session-row"
            >
              <td className="sessions__title">
                <button type="button" className="link-button" onClick={() => onSelect(session.id)}>
                  {session.title?.trim() || 'Untitled session'}
                </button>
                <span className="sessions__id">{session.id}</span>
              </td>
              <td>{session.agent ?? '—'}</td>
              <td className="sessions__model" title={session.model ? undefined : 'No model registered'}>
                {modelLabel(session)}
              </td>
              <td>{session.projectLabel}</td>
              <td title={formatDateTime(session.timeUpdated)}>{formatRelativeTime(session.timeUpdated)}</td>
              <td>{formatTokens(session.tokens.input + session.tokens.output)}</td>
              <td>
                <CostValue cost={session.cost} />
              </td>
              <td>{session.childCount > 0 ? session.childCount : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
