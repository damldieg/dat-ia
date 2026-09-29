import { useMemo, useState } from 'react';
import type { HealthDTO, SessionDetailDTO, SessionFilter, SummaryDTO } from '../shared/types';
import { api } from './lib/api';
import {
  DEFAULT_FILTER,
  applyRange,
  isFilterActive,
  type RangeState,
} from './lib/filters';
import { useAsync } from './lib/useAsync';
import { FilterBar } from './components/FilterBar';
import { PrivacyNotice } from './components/PrivacyNotice';
import { SessionDetailTree } from './components/SessionDetailTree';
import { SessionTable } from './components/SessionTable';
import { SummaryCards } from './components/SummaryCards';
import { EmptyPanel, ErrorPanel, LoadingPanel } from './components/StatusPanels';

const NO_SUMMARY: SummaryDTO['facets'] = { agents: [], models: [], projects: [] };

export function App() {
  const [filter, setFilter] = useState<SessionFilter>(DEFAULT_FILTER);
  const [range, setRange] = useState<RangeState>({ preset: 'all' });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const effectiveFilter = useMemo(() => applyRange(filter, range), [filter, range]);

  const summary = useAsync<SummaryDTO>((signal) => api.summary(signal), []);
  const sessions = useAsync((signal) => api.sessions(effectiveFilter, signal), [effectiveFilter]);
  const health = useAsync<HealthDTO>((signal) => api.health(signal), []);
  const detail = useAsync<SessionDetailDTO | null>(
    (signal) => (selectedId ? api.session(selectedId, signal) : Promise.resolve(null)),
    [selectedId],
  );

  const refreshAll = () => {
    summary.reload();
    sessions.reload();
    health.reload();
  };

  const resetFilters = () => {
    setFilter(DEFAULT_FILTER);
    setRange({ preset: 'all' });
  };

  const facets = summary.state.status === 'ready' ? summary.state.data.facets : NO_SUMMARY;
  const filtered = isFilterActive(effectiveFilter);

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>OpenCode Session Dashboard</h1>
          <p className="app__subtitle">Local observability for OpenCode sessions — read-only</p>
        </div>
        <button type="button" onClick={refreshAll}>
          Refresh
        </button>
      </header>

      <PrivacyNotice />

      {summary.state.status === 'loading' ? <LoadingPanel label="Loading summary…" /> : null}
      {summary.state.status === 'error' ? (
        <ErrorPanel message={summary.state.message} onRetry={summary.reload} />
      ) : null}
      {summary.state.status === 'ready' ? <SummaryCards summary={summary.state.data} /> : null}

      <FilterBar
        filter={filter}
        range={range}
        facets={facets}
        onFilterChange={setFilter}
        onRangeChange={setRange}
        onReset={resetFilters}
      />

      <main className="app__main">
        <section className="app__list" aria-label="Sessions">
          {sessions.state.status === 'loading' ? <LoadingPanel label="Loading sessions…" /> : null}
          {sessions.state.status === 'error' ? (
            <ErrorPanel message={sessions.state.message} onRetry={sessions.reload} />
          ) : null}
          {sessions.state.status === 'ready' && sessions.state.data.sessions.length === 0 ? (
            <EmptyPanel filtered={filtered} onReset={resetFilters} />
          ) : null}
          {sessions.state.status === 'ready' && sessions.state.data.sessions.length > 0 ? (
            <SessionTable
              sessions={sessions.state.data.sessions}
              total={sessions.state.data.total}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : null}
        </section>

        <aside className="app__detail" aria-label="Session detail">
          {selectedId === null ? (
            <p className="detail__placeholder">Select a session to inspect its child-session tree.</p>
          ) : detail.state.status === 'loading' ? (
            <LoadingPanel label="Loading session…" />
          ) : detail.state.status === 'error' ? (
            <ErrorPanel message={detail.state.message} onRetry={detail.reload} />
          ) : detail.state.data ? (
            <SessionDetailTree detail={detail.state.data} onSelect={setSelectedId} onClose={() => setSelectedId(null)} />
          ) : null}
        </aside>
      </main>

      <footer className="app__footer">
        <span>
          API: <code>/api/summary</code>, <code>/api/sessions</code>, <code>/api/sessions/:id</code>,{' '}
          <code>/api/health</code>
        </span>
        {health.state.status === 'ready' ? (
          <span title={health.state.data.dbPath}>
            DB {health.state.data.dbExists ? 'read-only ✓' : 'missing'} — {health.state.data.dbPath}
          </span>
        ) : null}
        {health.state.status === 'error' ? <span className="app__footer-error">{health.state.message}</span> : null}
      </footer>
    </div>
  );
}
