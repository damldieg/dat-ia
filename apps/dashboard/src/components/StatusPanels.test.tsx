import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyPanel, ErrorPanel, LoadingPanel } from './StatusPanels';

describe('StatusPanels', () => {
  test('loading panel is announced as a status region', () => {
    const markup = renderToStaticMarkup(<LoadingPanel label="Loading sessions…" />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Loading sessions…');
  });

  test('error panel surfaces the message and a retry action', () => {
    const markup = renderToStaticMarkup(<ErrorPanel message="database is locked" onRetry={() => undefined} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('database is locked');
    expect(markup).toContain('Retry');
  });

  test('empty panel explains the filtered case and offers a reset', () => {
    const filtered = renderToStaticMarkup(<EmptyPanel filtered onReset={() => undefined} />);
    expect(filtered).toContain('No sessions match the current filters');
    expect(filtered).toContain('Clear filters');
  });

  test('empty panel explains the genuinely empty database case', () => {
    const unfiltered = renderToStaticMarkup(<EmptyPanel filtered={false} onReset={() => undefined} />);
    expect(unfiltered).toContain('No sessions recorded yet');
    expect(unfiltered).not.toContain('Clear filters');
  });
});
