import type { SessionDetailDTO, SessionDTO } from '../../shared/types';
import { formatDateTime, formatRelativeTime, formatTokenUsage } from '../lib/format';
import { buildTree, type TreeNode } from '../lib/tree';
import { CostValue } from './CostValue';

interface SessionDetailTreeProps {
  detail: SessionDetailDTO;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function modelLabel(session: SessionDTO): string {
  if (!session.model) return 'No model registered';
  const variant = session.model.variant ? `#${session.model.variant}` : '';
  return `${session.model.providerId}/${session.model.id}${variant}`;
}

function TreeItem({
  node,
  onSelect,
}: {
  node: TreeNode;
  onSelect: (id: string) => void;
}) {
  const { session } = node;
  return (
    <li className="tree__item">
      <div className="tree__node">
        <button type="button" className="link-button" onClick={() => onSelect(session.id)}>
          {session.title?.trim() || 'Untitled session'}
        </button>
        <span className="tree__meta">
          {session.agent ?? 'no agent'} · {modelLabel(session)} · {formatTokenUsage(session.tokens)} ·{' '}
          <CostValue cost={session.cost} /> · updated {formatRelativeTime(session.timeUpdated)}
        </span>
      </div>
      {node.children.length > 0 ? (
        <ul className="tree__children">
          {node.children.map((child) => (
            <TreeItem key={child.session.id} node={child} onSelect={onSelect} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Selected session header plus its descendant tree (depth-first, indented). */
export function SessionDetailTree({ detail, onSelect, onClose }: SessionDetailTreeProps) {
  const root = detail.session;
  const tree = buildTree([root, ...detail.descendants]);

  return (
    <section className="detail" aria-label="Session detail">
      <header className="detail__header">
        <div>
          <h2 className="detail__title">{root.title?.trim() || 'Untitled session'}</h2>
          <p className="detail__id">{root.id}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close session detail">
          ✕
        </button>
      </header>

      <dl className="detail__facts">
        <div>
          <dt>Directory</dt>
          <dd>{root.directory}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{root.projectLabel}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{root.agent ?? '—'}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{modelLabel(root)}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>
            <CostValue cost={root.cost} />
          </dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>{formatTokenUsage(root.tokens)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDateTime(root.timeCreated)}</dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>{formatDateTime(root.timeUpdated)}</dd>
        </div>
      </dl>

      <h3 className="detail__subtitle">
        Descendant tree ({detail.descendants.length} {detail.descendants.length === 1 ? 'child' : 'children'})
      </h3>
      {detail.descendants.length === 0 ? (
        <p className="detail__empty">This session has no child sessions.</p>
      ) : (
        <ul className="tree" data-testid="detail-tree">
          {tree.map((node) => (
            <TreeItem key={node.session.id} node={node} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </section>
  );
}
