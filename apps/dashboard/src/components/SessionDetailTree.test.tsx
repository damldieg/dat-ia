import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionDetailTree } from './SessionDetailTree';
import { makeSession } from '../lib/testFixtures';
import type { SessionDetailDTO } from '../../shared/types';

describe('SessionDetailTree', () => {
  const detail: SessionDetailDTO = {
    session: makeSession({ id: 'ses_root', title: 'Root task' }),
    descendants: [
      makeSession({ id: 'ses_child', parentId: 'ses_root', title: 'Child task' }),
      makeSession({ id: 'ses_grand', parentId: 'ses_child', title: 'Grandchild task' }),
    ],
  };

  test('renders the selected session with its nested descendant tree', () => {
    const markup = renderToStaticMarkup(
      <SessionDetailTree detail={detail} onSelect={() => undefined} onClose={() => undefined} />,
    );
    expect(markup).toContain('Root task');
    expect(markup).toContain('Child task');
    expect(markup).toContain('Grandchild task');
    expect(markup).toContain('data-testid="detail-tree"');
    expect(markup).toContain('2 children');
    expect(markup.indexOf('Child task')).toBeLessThan(markup.indexOf('Grandchild task'));
  });

  test('renders a clear empty state for a leaf session', () => {
    const leaf: SessionDetailDTO = { session: makeSession({ id: 'ses_leaf' }), descendants: [] };
    const markup = renderToStaticMarkup(
      <SessionDetailTree detail={leaf} onSelect={() => undefined} onClose={() => undefined} />,
    );
    expect(markup).toContain('This session has no child sessions.');
    expect(markup).not.toContain('data-testid="detail-tree"');
  });

  test('shows unknown cost in the session facts', () => {
    const unknownCost: SessionDetailDTO = {
      session: makeSession({ id: 'ses_x', model: null, cost: { status: 'unavailable', reason: 'no-registered-model' } }),
      descendants: [],
    };
    const markup = renderToStaticMarkup(
      <SessionDetailTree detail={unknownCost} onSelect={() => undefined} onClose={() => undefined} />,
    );
    expect(markup).toContain('Cost not registered for this session');
    expect(markup).toContain('No model registered');
  });
});
