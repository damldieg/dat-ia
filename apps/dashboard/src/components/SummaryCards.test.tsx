import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SummaryCards } from './SummaryCards';
import { makeSummary } from '../lib/testFixtures';

describe('SummaryCards', () => {
  test('shows session counts and registered cost totals', () => {
    const markup = renderToStaticMarkup(<SummaryCards summary={makeSummary()} />);
    expect(markup).toContain('Sessions');
    expect(markup).toContain('3 roots · 2 children');
    expect(markup).toContain('$0.75');
    expect(markup).toContain('4 sessions registered · 2 sessions at $0.00');
  });

  test('calls out sessions whose cost is not registered', () => {
    const markup = renderToStaticMarkup(<SummaryCards summary={makeSummary()} />);
    expect(markup).toContain('1 session without registered cost (shown as —)');
  });

  test('omits the unknown-cost warning when every cost is registered', () => {
    const summary = makeSummary();
    const markup = renderToStaticMarkup(
      <SummaryCards
        summary={{ ...summary, cost: { ...summary.cost, unavailableSessions: 0 } }}
      />,
    );
    expect(markup).not.toContain('without registered cost');
  });

  test('renders an em dash activity range when no session exists', () => {
    const markup = renderToStaticMarkup(
      <SummaryCards summary={{ ...makeSummary(), timeRange: null, sessions: { total: 0, roots: 0, children: 0 } }} />,
    );
    expect(markup).toContain('no sessions recorded');
  });
});
