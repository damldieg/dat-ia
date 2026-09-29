export function LoadingPanel({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="panel panel--loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="panel panel--error" role="alert">
      <p className="panel__title">Could not load data</p>
      <p className="panel__message">{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export function EmptyPanel({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return (
    <div className="panel panel--empty" role="status">
      <p className="panel__title">
        {filtered ? 'No sessions match the current filters' : 'No sessions recorded yet'}
      </p>
      <p className="panel__message">
        {filtered
          ? 'Widen the time range or clear a filter to see more sessions.'
          : 'Start OpenCode in this project and sessions will appear here after the next refresh.'}
      </p>
      {filtered ? (
        <button type="button" onClick={onReset}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
