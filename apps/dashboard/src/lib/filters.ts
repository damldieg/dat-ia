import type { ChildrenMode, SessionFilter } from '../../shared/types';

export const DEFAULT_LIMIT = 100;

export const DEFAULT_FILTER: SessionFilter = {
  children: 'include',
  limit: DEFAULT_LIMIT,
  offset: 0,
};

export type RangePresetId = 'all' | '24h' | '7d' | '30d' | 'custom';

export interface RangeState {
  preset: RangePresetId;
  from?: number;
  to?: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const RANGE_PRESETS: { id: RangePresetId; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom range' },
];

export function presetRange(preset: RangePresetId, now: number = Date.now()): { from?: number; to?: number } {
  switch (preset) {
    case '24h':
      return { from: now - DAY };
    case '7d':
      return { from: now - 7 * DAY };
    case '30d':
      return { from: now - 30 * DAY };
    default:
      return {};
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Renders an epoch-millisecond value as a `datetime-local` value in local time. */
export function toDateTimeLocal(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parses a `datetime-local` value (local time) back to epoch milliseconds. */
export function fromDateTimeLocal(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Merges the selected time range into the base filter. */
export function applyRange(base: SessionFilter, range: RangeState): SessionFilter {
  let window: { from?: number; to?: number };
  if (range.preset === 'custom') {
    window = { from: range.from, to: range.to };
  } else if (range.from !== undefined) {
    // Freeze the preset window at selection time so other filter changes do not shift it.
    window = { from: range.from };
  } else {
    window = presetRange(range.preset);
  }
  const next: SessionFilter = { ...base };
  delete next.from;
  delete next.to;
  if (window.from !== undefined) next.from = window.from;
  if (window.to !== undefined) next.to = window.to;
  return next;
}

export const CHILDREN_OPTIONS: { id: ChildrenMode; label: string }[] = [
  { id: 'include', label: 'All sessions' },
  { id: 'exclude', label: 'Root sessions only' },
  { id: 'only', label: 'Child sessions only' },
];

/** True when any filter narrows the result set (used to phrase the empty state). */
export function isFilterActive(filter: SessionFilter): boolean {
  return (
    filter.from !== undefined ||
    filter.to !== undefined ||
    Boolean(filter.agent) ||
    Boolean(filter.model) ||
    Boolean(filter.project) ||
    (filter.children !== undefined && filter.children !== 'include')
  );
}
