import { useMemo, useState } from 'react';
import type { BudgetsDTO, HealthDTO, SessionFilter, SummaryDTO, TaskDetailDTO } from '../shared/types';
import { api } from './lib/api';
import {
  DEFAULT_FILTER,
  applyRange,
  isFilterActive,
  type RangeState,
} from './lib/filters';
import { useAsync } from './lib/useAsync';
import { BudgetPanel } from './components/BudgetPanel';
import { FilterBar } from './components/FilterBar';
import { PrivacyNotice } from './components/PrivacyNotice';
import { SummaryCards } from './components/SummaryCards';
import { TaskModal } from './components/TaskModal';
import { TaskTable } from './components/TaskTable';
import { EmptyPanel, ErrorPanel, LoadingPanel } from './components/StatusPanels';

const NO_SUMMARY: SummaryDTO['facets'] = { agents: [], models: [], projects: [] };

export function App() {
  const [filter, setFilter] = useState<SessionFilter>(DEFAULT_FILTER);
  const [range, setRange] = useState<RangeState>({ preset: 'all' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** `undefined` = the current month. */
  const [budgetMonth, setBudgetMonth] = useState<string | undefined>(undefined);

  const effectiveFilter = useMemo(() => applyRange(filter, range), [filter, range]);

  const summary = useAsync<SummaryDTO>((signal) => api.summary(signal), []);
  const tasks = useAsync((signal) => api.tasks(effectiveFilter, signal), [effectiveFilter]);
  const budgets = useAsync<BudgetsDTO>((signal) => api.budgets(budgetMonth, signal), [budgetMonth]);
  const health = useAsync<HealthDTO>((signal) => api.health(signal), []);
  const detail = useAsync<TaskDetailDTO | null>(
    (signal) => (selectedId ? api.task(selectedId, signal) : Promise.resolve(null)),
    [selectedId],
  );

  const refreshAll = () => {
    summary.reload();
    tasks.reload();
    budgets.reload();
    health.reload();
  };

  const resetFilters = () => {
    setFilter(DEFAULT_FILTER);
    setRange({ preset: 'all' });
  };

  const facets = summary.state.status === 'ready' ? summary.state.data.facets : NO_SUMMARY;
  const filtered = isFilterActive(effectiveFilter);
  const taskList = tasks.state.status === 'ready' ? tasks.state.data : null;
  // The listed row opens the modal at once; the fresh detail keeps it open while the list reloads.
  const listedTask = selectedId ? (taskList?.tasks.find((task) => task.session.id === selectedId) ?? null) : null;
  const detailTask = detail.state.status === 'ready' ? (detail.state.data?.task ?? null) : null;
  const selectedTask = selectedId ? (listedTask ?? detailTask) : null;

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>OpenCode Session Dashboard</h1>
          <p className="app__subtitle">
            One row per orchestrator session, with its subagent calls folded in — local and read-only
          </p>
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

      {budgets.state.status === 'loading' ? <LoadingPanel label="Loading monthly budget…" /> : null}
      {budgets.state.status === 'error' ? (
        <ErrorPanel message={budgets.state.message} onRetry={budgets.reload} />
      ) : null}
      {budgets.state.status === 'ready' ? (
        <BudgetPanel budgets={budgets.state.data} onMonthChange={setBudgetMonth} />
      ) : null}

      <FilterBar
        filter={filter}
        range={range}
        facets={facets}
        onFilterChange={setFilter}
        onRangeChange={setRange}
        onReset={resetFilters}
      />

      <main className="app__main" aria-label="Tasks">
        {tasks.state.status === 'loading' ? <LoadingPanel label="Loading tasks…" /> : null}
        {tasks.state.status === 'error' ? <ErrorPanel message={tasks.state.message} onRetry={tasks.reload} /> : null}
        {taskList && taskList.tasks.length === 0 ? <EmptyPanel filtered={filtered} onReset={resetFilters} /> : null}
        {taskList && taskList.tasks.length > 0 ? (
          <TaskTable tasks={taskList.tasks} total={taskList.total} selectedId={selectedId} onSelect={setSelectedId} />
        ) : null}
        {taskList && taskList.total > taskList.tasks.length ? (
          <p className="app__more">
            Showing the {taskList.tasks.length} most recent of {taskList.total} tasks. Narrow the filters to see older
            ones.
          </p>
        ) : null}
      </main>

      {selectedTask ? (
        <TaskModal
          key={selectedTask.session.id}
          task={selectedTask}
          detail={detail.state}
          onRetry={detail.reload}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      <footer className="app__footer">
        <span>
          API: <code>/api/summary</code>, <code>/api/tasks</code>, <code>/api/tasks/:id</code>,{' '}
          <code>/api/budgets</code>, <code>/api/sessions</code>, <code>/api/health</code>
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
