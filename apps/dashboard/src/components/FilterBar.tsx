import type { SessionFilter, SummaryDTO } from '../../shared/types';
import {
  CHILDREN_OPTIONS,
  RANGE_PRESETS,
  fromDateTimeLocal,
  presetRange,
  toDateTimeLocal,
  type RangeState,
} from '../lib/filters';

interface FilterBarProps {
  filter: SessionFilter;
  range: RangeState;
  facets: SummaryDTO['facets'];
  onFilterChange: (filter: SessionFilter) => void;
  onRangeChange: (range: RangeState) => void;
  onReset: () => void;
}

function facetOptions(facets: SummaryDTO['facets'][keyof SummaryDTO['facets']]) {
  return facets.map((facet) => (
    <option key={facet.value} value={facet.value}>
      {facet.label} ({facet.count})
    </option>
  ));
}

export function FilterBar({ filter, range, facets, onFilterChange, onRangeChange, onReset }: FilterBarProps) {
  const customFrom = range.from !== undefined ? toDateTimeLocal(range.from) : '';
  const customTo = range.to !== undefined ? toDateTimeLocal(range.to) : '';

  const select = (patch: Partial<SessionFilter>) => onFilterChange({ ...filter, ...patch });

  return (
    <section className="filters" aria-label="Filters">
      <label className="filters__field">
        <span>Time range</span>
        <select
          value={range.preset}
          onChange={(event) => {
            const preset = event.target.value as RangeState['preset'];
            const window = presetRange(preset);
            onRangeChange({ preset, ...window });
          }}
        >
          {RANGE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      {range.preset === 'custom' ? (
        <>
          <label className="filters__field">
            <span>From</span>
            <input
              type="datetime-local"
              value={customFrom}
              onChange={(event) => onRangeChange({ ...range, from: fromDateTimeLocal(event.target.value) })}
            />
          </label>
          <label className="filters__field">
            <span>To</span>
            <input
              type="datetime-local"
              value={customTo}
              onChange={(event) => onRangeChange({ ...range, to: fromDateTimeLocal(event.target.value) })}
            />
          </label>
        </>
      ) : null}

      <label className="filters__field">
        <span>Agent</span>
        <select value={filter.agent ?? ''} onChange={(event) => select({ agent: event.target.value || undefined })}>
          <option value="">All agents</option>
          {facetOptions(facets.agents)}
        </select>
      </label>

      <label className="filters__field">
        <span>Model</span>
        <select value={filter.model ?? ''} onChange={(event) => select({ model: event.target.value || undefined })}>
          <option value="">All models</option>
          {facetOptions(facets.models)}
        </select>
      </label>

      <label className="filters__field">
        <span>Project</span>
        <select value={filter.project ?? ''} onChange={(event) => select({ project: event.target.value || undefined })}>
          <option value="">All projects</option>
          {facetOptions(facets.projects)}
        </select>
      </label>

      <label className="filters__field">
        <span>Sessions</span>
        <select
          value={filter.children ?? 'include'}
          onChange={(event) => select({ children: event.target.value as SessionFilter['children'] })}
        >
          {CHILDREN_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button type="button" className="filters__reset" onClick={onReset}>
        Reset
      </button>
    </section>
  );
}
