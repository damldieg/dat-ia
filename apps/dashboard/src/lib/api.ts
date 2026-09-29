import type {
  ApiErrorBody,
  SessionDetailDTO,
  SessionFilter,
  SessionListDTO,
  SummaryDTO,
  HealthDTO,
} from '../../shared/types';

/** Error raised when the local API answers with a non-2xx status. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

/** Serializes the shared filter into validated query parameters. */
export function sessionsToQuery(filter: SessionFilter): string {
  const params = new URLSearchParams();
  if (filter.from !== undefined) params.set('from', String(filter.from));
  if (filter.to !== undefined) params.set('to', String(filter.to));
  if (filter.agent) params.set('agent', filter.agent);
  if (filter.model) params.set('model', filter.model);
  if (filter.project) params.set('project', filter.project);
  if (filter.children) params.set('children', filter.children);
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.offset !== undefined) params.set('offset', String(filter.offset));
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    const message = body?.error?.message ?? `Request failed with status ${response.status}.`;
    const code = body?.error?.code ?? 'request-failed';
    throw new ApiClientError(response.status, code, message);
  }
  return payload as T;
}

export const api = {
  summary: (signal?: AbortSignal) => getJson<SummaryDTO>('/api/summary', signal),
  sessions: (filter: SessionFilter, signal?: AbortSignal) =>
    getJson<SessionListDTO>(`/api/sessions${sessionsToQuery(filter)}`, signal),
  session: (id: string, signal?: AbortSignal) =>
    getJson<SessionDetailDTO>(`/api/sessions/${encodeURIComponent(id)}`, signal),
  health: (signal?: AbortSignal) => getJson<HealthDTO>('/api/health', signal),
};
