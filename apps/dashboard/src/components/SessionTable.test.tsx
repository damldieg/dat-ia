import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionTable } from './SessionTable';
import { makeSession } from '../lib/testFixtures';

function render(sessions = [makeSession({ id: 'ses_a' })], selectedId: string | null = null) {
  return renderToStaticMarkup(
    <SessionTable sessions={sessions} total={sessions.length} selectedId={selectedId} onSelect={() => undefined} />,
  );
}

describe('SessionTable', () => {
  test('renders session title, agent, model and project', () => {
    const markup = render();
    expect(markup).toContain('Session ses_a');
    expect(markup).toContain('general');
    expect(markup).toContain('opencode/mimo-v2.6-flash-free');
    expect(markup).toContain('dat-ia');
  });

  test('renders a registered cost and marks the selected row', () => {
    const markup = render([makeSession({ id: 'ses_a', cost: { status: 'known', value: 0 } })], 'ses_a');
    expect(markup).toContain('data-status="known"');
    expect(markup).toContain('$0.00');
    expect(markup).toContain('is-selected');
  });

  test('renders unknown cost as an em dash with an explanatory title', () => {
    const markup = render([
      makeSession({ id: 'ses_a', model: null, modelKey: null, cost: { status: 'unavailable', reason: 'no-registered-model' } }),
    ]);
    expect(markup).toContain('data-status="unavailable"');
    expect(markup).toContain('Cost not registered for this session');
    expect(markup).not.toContain('$0.00');
  });

  test('falls back to a placeholder for untitled sessions and missing agents', () => {
    const markup = render([makeSession({ id: 'ses_a', title: null, agent: null, model: null })]);
    expect(markup).toContain('Untitled session');
    expect(markup).toContain('No model registered');
  });

  test('shows a dash for sessions without children', () => {
    const markup = render([makeSession({ id: 'ses_a', childCount: 0 })]);
    expect(markup).toContain('<td>—</td>');
  });
});
