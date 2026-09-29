/**
 * Static SQL statements for the session read model.
 *
 * Rules:
 * - Only `session_v2` and `project` are read. Message, event, account,
 *   credential, permission, share and metadata tables are never touched.
 * - Columns are listed explicitly; `SELECT *` is never used.
 * - Filters are composed from fixed SQL fragments with `?` placeholders and
 *   bound parameters, so user input is never interpolated into SQL.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { ChildrenMode } from '../shared/types.ts';

export interface SessionRow {
  id: string;
  parent_id: string | null;
  project_id: string;
  directory: string;
  title: string | null;
  agent: string | null;
  model_json: string | null;
  model_key: string | null;
  time_created: number;
  time_updated: number;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  child_count: number;
  project_name: string | null;
  project_worktree: string | null;
}

export interface SummaryRow {
  total: number;
  roots: number;
  cost_unavailable: number;
  cost_known_total: number;
  cost_zero: number;
  cost_positive: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  earliest: number | null;
  latest: number | null;
}

export interface FacetRow {
  value: string;
  count: number;
}

export interface ProjectFacetRow {
  id: string;
  name: string | null;
  worktree: string | null;
  count: number;
}

/** A session has a registered cost only when it has a registered, parseable model. */
const MODEL_REGISTERED_SQL =
  "s.model IS NOT NULL AND json_valid(s.model) = 1 AND json_extract(s.model, '$.id') IS NOT NULL AND json_extract(s.model, '$.providerID') IS NOT NULL";

const MODEL_KEY_SQL = `CASE WHEN ${MODEL_REGISTERED_SQL} THEN json_extract(s.model, '$.providerID') || '/' || json_extract(s.model, '$.id') END`;

const SESSION_SELECT = `
  SELECT
    s.id,
    s.parent_id,
    s.project_id,
    s.directory,
    s.title,
    s.agent,
    s.model AS model_json,
    ${MODEL_KEY_SQL} AS model_key,
    s.time_created,
    s.time_updated,
    s.cost,
    s.tokens_input,
    s.tokens_output,
    s.tokens_reasoning,
    s.tokens_cache_read,
    s.tokens_cache_write,
    (SELECT COUNT(*) FROM session_v2 c WHERE c.parent_id = s.id) AS child_count,
    p.name AS project_name,
    p.worktree AS project_worktree
  FROM session_v2 s
  LEFT JOIN project p ON p.id = s.project_id`;

export interface ResolvedFilter {
  from?: number;
  to?: number;
  agent?: string;
  model?: string;
  project?: string;
  children: ChildrenMode;
  limit: number;
  offset: number;
}

interface WhereClause {
  sql: string;
  params: (string | number)[];
}

function buildWhere(filter: ResolvedFilter): WhereClause {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter.from !== undefined) {
    clauses.push('s.time_updated >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push('s.time_updated <= ?');
    params.push(filter.to);
  }
  if (filter.agent !== undefined) {
    clauses.push('s.agent = ?');
    params.push(filter.agent);
  }
  if (filter.model !== undefined) {
    clauses.push(`${MODEL_KEY_SQL} = ?`);
    params.push(filter.model);
  }
  if (filter.project !== undefined) {
    clauses.push('s.project_id = ?');
    params.push(filter.project);
  }
  if (filter.children === 'only') clauses.push('s.parent_id IS NOT NULL');
  if (filter.children === 'exclude') clauses.push('s.parent_id IS NULL');

  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function listSessions(db: DatabaseSync, filter: ResolvedFilter): { rows: SessionRow[]; total: number } {
  const where = buildWhere(filter);
  const rows = db
    .prepare(`${SESSION_SELECT} ${where.sql} ORDER BY s.time_updated DESC, s.id ASC LIMIT ? OFFSET ?`)
    .all(...where.params, filter.limit, filter.offset) as unknown as SessionRow[];

  const countRow = db
    .prepare(`SELECT COUNT(*) AS n FROM session_v2 s ${where.sql}`)
    .get(...where.params) as { n: number } | undefined;

  return { rows, total: countRow?.n ?? 0 };
}

export function getSession(db: DatabaseSync, id: string): SessionRow | undefined {
  return db.prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(id) as SessionRow | undefined;
}

/** Depth-first descendant lookup. `UNION` deduplicates, so cycles terminate. */
export function getDescendants(db: DatabaseSync, id: string): SessionRow[] {
  const sql = `
    WITH RECURSIVE chain(id) AS (
      SELECT id FROM session_v2 WHERE parent_id = ?
      UNION
      SELECT c.id FROM session_v2 c INNER JOIN chain ch ON c.parent_id = ch.id
    )
    SELECT
      s.id,
      s.parent_id,
      s.project_id,
      s.directory,
      s.title,
      s.agent,
      s.model AS model_json,
      ${MODEL_KEY_SQL} AS model_key,
      s.time_created,
      s.time_updated,
      s.cost,
      s.tokens_input,
      s.tokens_output,
      s.tokens_reasoning,
      s.tokens_cache_read,
      s.tokens_cache_write,
      (SELECT COUNT(*) FROM session_v2 c2 WHERE c2.parent_id = s.id) AS child_count,
      p.name AS project_name,
      p.worktree AS project_worktree
    FROM session_v2 s
    INNER JOIN chain ch ON ch.id = s.id
    LEFT JOIN project p ON p.id = s.project_id
    ORDER BY s.time_created ASC, s.id ASC`;
  return db.prepare(sql).all(id) as unknown as SessionRow[];
}

export function getSummary(db: DatabaseSync): SummaryRow {
  const sql = `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN s.parent_id IS NULL THEN 1 ELSE 0 END), 0) AS roots,
      COALESCE(SUM(CASE WHEN ${MODEL_REGISTERED_SQL} THEN 0 ELSE 1 END), 0) AS cost_unavailable,
      COALESCE(SUM(CASE WHEN ${MODEL_REGISTERED_SQL} THEN s.cost ELSE 0 END), 0) AS cost_known_total,
      COALESCE(SUM(CASE WHEN ${MODEL_REGISTERED_SQL} AND s.cost = 0 THEN 1 ELSE 0 END), 0) AS cost_zero,
      COALESCE(SUM(CASE WHEN ${MODEL_REGISTERED_SQL} AND s.cost > 0 THEN 1 ELSE 0 END), 0) AS cost_positive,
      COALESCE(SUM(s.tokens_input), 0) AS tokens_input,
      COALESCE(SUM(s.tokens_output), 0) AS tokens_output,
      COALESCE(SUM(s.tokens_reasoning), 0) AS tokens_reasoning,
      COALESCE(SUM(s.tokens_cache_read), 0) AS tokens_cache_read,
      COALESCE(SUM(s.tokens_cache_write), 0) AS tokens_cache_write,
      MIN(s.time_created) AS earliest,
      MAX(s.time_updated) AS latest
    FROM session_v2 s`;
  return db.prepare(sql).get() as unknown as SummaryRow;
}

export function getAgentFacets(db: DatabaseSync): FacetRow[] {
  const sql = `
    SELECT s.agent AS value, COUNT(*) AS count
    FROM session_v2 s
    WHERE s.agent IS NOT NULL AND s.agent <> ''
    GROUP BY s.agent
    ORDER BY count DESC, s.agent ASC`;
  return db.prepare(sql).all() as unknown as FacetRow[];
}

export function getModelFacets(db: DatabaseSync): FacetRow[] {
  const sql = `
    SELECT ${MODEL_KEY_SQL} AS value, COUNT(*) AS count
    FROM session_v2 s
    WHERE ${MODEL_KEY_SQL} IS NOT NULL
    GROUP BY value
    ORDER BY count DESC, value ASC`;
  return db.prepare(sql).all() as unknown as FacetRow[];
}

export function getProjectFacets(db: DatabaseSync): ProjectFacetRow[] {
  const sql = `
    SELECT s.project_id AS id, p.name AS name, p.worktree AS worktree, COUNT(*) AS count
    FROM session_v2 s
    LEFT JOIN project p ON p.id = s.project_id
    GROUP BY s.project_id, p.name, p.worktree
    ORDER BY count DESC, s.project_id ASC`;
  return db.prepare(sql).all() as unknown as ProjectFacetRow[];
}
