/**
 * Query-string validation for `GET /api/sessions`.
 *
 * Every parameter is validated against an explicit type, range or enum before
 * it reaches SQL. Unknown parameters are ignored (forward compatibility);
 * invalid values produce a 400 naming the offending field.
 */
import type { ChildrenMode } from '../shared/types.ts';
import type { ParamErrorDetail } from './errors.ts';
import type { ResolvedFilter } from './store.ts';

export const CHILDREN_MODES: ChildrenMode[] = ['include', 'only', 'exclude'];
export const MAX_LIMIT = 500;
export const DEFAULT_LIMIT = 100;
export const MAX_VALUE_LENGTH = 200;
export const MAX_TIME_MS = Number.MAX_SAFE_INTEGER;

type ParseResult = { ok: true; value: ResolvedFilter } | { ok: false; detail: ParamErrorDetail };
type IntResult = { ok: true; value?: number } | { ok: false; detail: ParamErrorDetail };
type TextResult = { ok: true; value?: string } | { ok: false; detail: ParamErrorDetail };

function parseIntParam(raw: string | null, field: string, min: number, max: number): IntResult {
  if (raw === null || raw.trim() === '') return { ok: true };
  if (!/^-?\d{1,15}$/.test(raw.trim())) {
    return { ok: false, detail: { field, message: `${field} must be an integer (epoch milliseconds).` } };
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (value < min || value > max) {
    return { ok: false, detail: { field, message: `${field} must be between ${min} and ${max}.` } };
  }
  return { ok: true, value };
}

function parseTextParam(raw: string | null, field: string): TextResult {
  if (raw === null) return { ok: true };
  const value = raw.trim();
  if (value === '') return { ok: true };
  if (value.length > MAX_VALUE_LENGTH) {
    return { ok: false, detail: { field, message: `${field} must be at most ${MAX_VALUE_LENGTH} characters.` } };
  }
  return { ok: true, value };
}

export function parseSessionParams(params: URLSearchParams): ParseResult {
  const filter: ResolvedFilter = { children: 'include', limit: DEFAULT_LIMIT, offset: 0 };

  const children = params.get('children');
  if (children !== null && !CHILDREN_MODES.includes(children as ChildrenMode)) {
    return { ok: false, detail: { field: 'children', message: 'children must be one of the supported modes.', allowed: CHILDREN_MODES } };
  }
  if (children !== null) filter.children = children as ChildrenMode;

  const limit = parseIntParam(params.get('limit'), 'limit', 1, MAX_LIMIT);
  if (!limit.ok) return { ok: false, detail: limit.detail };
  if (limit.value !== undefined) filter.limit = limit.value;

  const offset = parseIntParam(params.get('offset'), 'offset', 0, 1_000_000);
  if (!offset.ok) return { ok: false, detail: offset.detail };
  if (offset.value !== undefined) filter.offset = offset.value;

  const from = parseIntParam(params.get('from'), 'from', 0, MAX_TIME_MS);
  if (!from.ok) return { ok: false, detail: from.detail };

  const to = parseIntParam(params.get('to'), 'to', 0, MAX_TIME_MS);
  if (!to.ok) return { ok: false, detail: to.detail };

  if (from.value !== undefined && to.value !== undefined && from.value > to.value) {
    return { ok: false, detail: { field: 'from', message: 'from must be less than or equal to to.' } };
  }

  const agent = parseTextParam(params.get('agent'), 'agent');
  if (!agent.ok) return { ok: false, detail: agent.detail };

  const model = parseTextParam(params.get('model'), 'model');
  if (!model.ok) return { ok: false, detail: model.detail };

  const project = parseTextParam(params.get('project'), 'project');
  if (!project.ok) return { ok: false, detail: project.detail };

  if (from.value !== undefined) filter.from = from.value;
  if (to.value !== undefined) filter.to = to.value;
  if (agent.value !== undefined) filter.agent = agent.value;
  if (model.value !== undefined) filter.model = model.value;
  if (project.value !== undefined) filter.project = project.value;

  return { ok: true, value: filter };
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}
