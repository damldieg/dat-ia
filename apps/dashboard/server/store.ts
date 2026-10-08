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

/** A root session plus the usage rolled up from every session below it. */
export interface TaskRow extends SessionRow {
  /** Latest `time_updated` across the root and all of its descendants. */
  last_activity: number;
  sub_calls: number;
  sub_cost: number;
  sub_cost_known: number;
  sub_cost_unavailable: number;
  sub_tokens_input: number;
  sub_tokens_output: number;
  sub_tokens_reasoning: number;
  sub_tokens_cache_read: number;
  sub_tokens_cache_write: number;
}

/** Subagent usage of one task, grouped by agent and model. */
export interface AgentUsageRow {
  root_id: string;
  agent: string | null;
  model_key: string | null;
  calls: number;
  cost: number;
  cost_known: number;
  cost_unavailable: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
}

/** Usage of one registered model inside a time window. */
export interface ModelUsageRow {
  model_key: string;
  sessions: number;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
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

/**
 * A session has a registered cost only when it has a registered, parseable model.
 * `alias` is always a code constant (a table alias), never request input.
 */
function modelRegisteredSql(alias: string): string {
  return `${alias}.model IS NOT NULL AND json_valid(${alias}.model) = 1 AND json_extract(${alias}.model, '$.id') IS NOT NULL AND json_extract(${alias}.model, '$.providerID') IS NOT NULL`;
}

function modelKeySql(alias: string): string {
  return `CASE WHEN ${modelRegisteredSql(alias)} THEN json_extract(${alias}.model, '$.providerID') || '/' || json_extract(${alias}.model, '$.id') END`;
}

const MODEL_REGISTERED_SQL = modelRegisteredSql('s');
const MODEL_KEY_SQL = modelKeySql('s');

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

/* ------------------------------------------------------------------------- *
 * Tasks: one row per root (orchestrator) session, with its subagent sessions
 * rolled up into it. Same rules as above: `session_v2` + `project` only,
 * explicit columns, bound parameters.
 * ------------------------------------------------------------------------- */

/**
 * Maps every session to the root of its tree. A session whose parent row is
 * missing is treated as a root, so orphans still show up as their own task.
 * `UNION` deduplicates `(id, root_id)` pairs, so a parent cycle terminates.
 */
const TREE_ALL_ROOTS_SQL = `
    tree(id, root_id) AS (
      SELECT r.id, r.id FROM session_v2 r
      WHERE r.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM session_v2 p WHERE p.id = r.parent_id)
      UNION
      SELECT c.id, t.root_id FROM session_v2 c INNER JOIN tree t ON c.parent_id = t.id
    )`;

/** Same mapping, restricted to the tree below one session (`?` = its id). */
const TREE_ONE_ROOT_SQL = `
    tree(id, root_id) AS (
      SELECT r.id, r.id FROM session_v2 r WHERE r.id = ?
      UNION
      SELECT c.id, t.root_id FROM session_v2 c INNER JOIN tree t ON c.parent_id = t.id
    )`;

const MEMBER_REGISTERED_SQL = modelRegisteredSql('m');
const MEMBER_MODEL_KEY_SQL = modelKeySql('m');
const IS_SUBAGENT_SQL = 't.id <> t.root_id';

/** Per-root rollup over the subagent sessions (`m` = a member of the tree). */
const ROLLUP_SQL = `
    rollup AS (
      SELECT
        t.root_id AS root_id,
        MAX(m.time_updated) AS last_activity,
        COALESCE(SUM(CASE WHEN ${IS_SUBAGENT_SQL} THEN 1 ELSE 0 END), 0) AS sub_calls,
        COALESCE(SUM(CASE WHEN ${IS_SUBAGENT_SQL} AND ${MEMBER_REGISTERED_SQL} THEN m.cost ELSE 0 END), 0) AS sub_cost,
        COALESCE(SUM(CASE WHEN ${IS_SUBAGENT_SQL} AND ${MEMBER_REGISTERED_SQL} THEN 1 ELSE 0 END), 0) AS sub_cost_known,
        COALESCE(SUM(CASE WHEN ${IS_SUBAGENT_SQL} THEN (CASE WHEN ${MEMBER_REGISTERED_SQL} THEN 0 ELSE 1 END) ELSE 0 END), 0) AS sub_cost_unavailable,
        COALESCE(SUM(CASE WHEN ${IS_SUBAGENT_SQL} THEN m.tokens_input ELSE 0 END), 0) AS sub_tokens_input,
        COALESCE(SUM(CASE WHEN ${IS_SUBAGENT_SQL} THEN m.tokens_output ELSE 0 END), 0) AS sub_tokens_output,
        COALESCE(SUM(CASE WHEN ${IS_SUBAGENT_SQL} THEN m.tokens_reasoning ELSE 0 END), 0) AS sub_tokens_reasoning,
        COALESCE(SUM(CASE WHEN ${IS_SUBAGENT_SQL} THEN m.tokens_cache_read ELSE 0 END), 0) AS sub_tokens_cache_read,
        COALESCE(SUM(CASE WHEN ${IS_SUBAGENT_SQL} THEN m.tokens_cache_write ELSE 0 END), 0) AS sub_tokens_cache_write
      FROM tree t
      INNER JOIN session_v2 m ON m.id = t.id
      GROUP BY t.root_id
    )`;

const TASK_SELECT = `
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
    p.worktree AS project_worktree,
    r.last_activity,
    r.sub_calls,
    r.sub_cost,
    r.sub_cost_known,
    r.sub_cost_unavailable,
    r.sub_tokens_input,
    r.sub_tokens_output,
    r.sub_tokens_reasoning,
    r.sub_tokens_cache_read,
    r.sub_tokens_cache_write
  FROM session_v2 s
  INNER JOIN rollup r ON r.root_id = s.id
  LEFT JOIN project p ON p.id = s.project_id`;

/**
 * Task filters. Time range applies to the latest activity anywhere in the
 * task; agent and model match when ANY session of the task (the orchestrator
 * or one of its subagents) used them; project is the orchestrator's project.
 */
function buildTaskWhere(filter: ResolvedFilter): WhereClause {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter.from !== undefined) {
    clauses.push('r.last_activity >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push('r.last_activity <= ?');
    params.push(filter.to);
  }
  if (filter.agent !== undefined) {
    clauses.push(
      'EXISTS (SELECT 1 FROM tree ft INNER JOIN session_v2 m ON m.id = ft.id WHERE ft.root_id = s.id AND m.agent = ?)',
    );
    params.push(filter.agent);
  }
  if (filter.model !== undefined) {
    clauses.push(
      `EXISTS (SELECT 1 FROM tree ft INNER JOIN session_v2 m ON m.id = ft.id WHERE ft.root_id = s.id AND ${MEMBER_MODEL_KEY_SQL} = ?)`,
    );
    params.push(filter.model);
  }
  if (filter.project !== undefined) {
    clauses.push('s.project_id = ?');
    params.push(filter.project);
  }

  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function listTasks(db: DatabaseSync, filter: ResolvedFilter): { rows: TaskRow[]; total: number } {
  const where = buildTaskWhere(filter);
  const cte = `WITH RECURSIVE ${TREE_ALL_ROOTS_SQL}, ${ROLLUP_SQL}`;
  const rows = db
    .prepare(`${cte} ${TASK_SELECT} ${where.sql} ORDER BY r.last_activity DESC, s.id ASC LIMIT ? OFFSET ?`)
    .all(...where.params, filter.limit, filter.offset) as unknown as TaskRow[];

  const countRow = db
    .prepare(`${cte} SELECT COUNT(*) AS n FROM session_v2 s INNER JOIN rollup r ON r.root_id = s.id ${where.sql}`)
    .get(...where.params) as { n: number } | undefined;

  return { rows, total: countRow?.n ?? 0 };
}

/**
 * Walks up from any session to the root of its tree, so a subagent session id
 * resolves to the task it belongs to. Returns `undefined` for an unknown id.
 */
export function findRootId(db: DatabaseSync, id: string): string | undefined {
  const sql = `
    WITH RECURSIVE up(id, parent_id) AS (
      SELECT id, parent_id FROM session_v2 WHERE id = ?
      UNION
      SELECT p.id, p.parent_id FROM session_v2 p INNER JOIN up u ON p.id = u.parent_id
    )
    SELECT u.id AS id FROM up u
    WHERE u.parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM session_v2 x WHERE x.id = u.parent_id)
    LIMIT 1`;
  const row = db.prepare(sql).get(id) as { id: string } | undefined;
  return row?.id;
}

/** One task by the id of its root session. */
export function getTask(db: DatabaseSync, rootId: string): TaskRow | undefined {
  const sql = `WITH RECURSIVE ${TREE_ONE_ROOT_SQL}, ${ROLLUP_SQL} ${TASK_SELECT} WHERE s.id = ?`;
  return db.prepare(sql).get(rootId, rootId) as TaskRow | undefined;
}

/**
 * Subagent usage grouped by (task, agent, model) for a set of root ids. The
 * ids travel as ONE bound JSON array (`json_each(?)`), so the SQL stays static
 * whatever the page size.
 */
export function getAgentUsage(db: DatabaseSync, rootIds: string[]): AgentUsageRow[] {
  if (rootIds.length === 0) return [];
  const sql = `
    WITH RECURSIVE
    tree(id, root_id) AS (
      SELECT r.id, r.id FROM session_v2 r WHERE r.id IN (SELECT value FROM json_each(?))
      UNION
      SELECT c.id, t.root_id FROM session_v2 c INNER JOIN tree t ON c.parent_id = t.id
    )
    SELECT
      t.root_id AS root_id,
      NULLIF(m.agent, '') AS agent,
      ${MEMBER_MODEL_KEY_SQL} AS model_key,
      COUNT(*) AS calls,
      COALESCE(SUM(CASE WHEN ${MEMBER_REGISTERED_SQL} THEN m.cost ELSE 0 END), 0) AS cost,
      COALESCE(SUM(CASE WHEN ${MEMBER_REGISTERED_SQL} THEN 1 ELSE 0 END), 0) AS cost_known,
      COALESCE(SUM(CASE WHEN ${MEMBER_REGISTERED_SQL} THEN 0 ELSE 1 END), 0) AS cost_unavailable,
      COALESCE(SUM(m.tokens_input), 0) AS tokens_input,
      COALESCE(SUM(m.tokens_output), 0) AS tokens_output,
      COALESCE(SUM(m.tokens_reasoning), 0) AS tokens_reasoning,
      COALESCE(SUM(m.tokens_cache_read), 0) AS tokens_cache_read,
      COALESCE(SUM(m.tokens_cache_write), 0) AS tokens_cache_write
    FROM tree t
    INNER JOIN session_v2 m ON m.id = t.id
    WHERE ${IS_SUBAGENT_SQL}
    GROUP BY t.root_id, NULLIF(m.agent, ''), ${MEMBER_MODEL_KEY_SQL}
    ORDER BY t.root_id ASC, agent ASC, model_key ASC`;
  return db.prepare(sql).all(JSON.stringify(rootIds)) as unknown as AgentUsageRow[];
}

/* ------------------------------------------------------------------------- *
 * Monthly usage per model (budget panel).
 * ------------------------------------------------------------------------- */

/**
 * Usage per registered model for sessions whose last activity falls in
 * `[from, to)`. Every session counts on its own row (orchestrator and
 * subagents alike), so nothing is counted twice.
 */
export function getModelUsage(db: DatabaseSync, from: number, to: number): ModelUsageRow[] {
  const sql = `
    SELECT
      ${MODEL_KEY_SQL} AS model_key,
      COUNT(*) AS sessions,
      COALESCE(SUM(s.cost), 0) AS cost,
      COALESCE(SUM(s.tokens_input), 0) AS tokens_input,
      COALESCE(SUM(s.tokens_output), 0) AS tokens_output,
      COALESCE(SUM(s.tokens_reasoning), 0) AS tokens_reasoning,
      COALESCE(SUM(s.tokens_cache_read), 0) AS tokens_cache_read,
      COALESCE(SUM(s.tokens_cache_write), 0) AS tokens_cache_write
    FROM session_v2 s
    WHERE ${MODEL_KEY_SQL} IS NOT NULL AND s.time_updated >= ? AND s.time_updated < ?
    GROUP BY model_key
    ORDER BY cost DESC, model_key ASC`;
  return db.prepare(sql).all(from, to) as unknown as ModelUsageRow[];
}

/** Sessions active in `[from, to)` with no registered model: they cannot be attributed to a budget. */
export function countSessionsWithoutModel(db: DatabaseSync, from: number, to: number): number {
  const sql = `
    SELECT COUNT(*) AS n
    FROM session_v2 s
    WHERE ${MODEL_KEY_SQL} IS NULL AND s.time_updated >= ? AND s.time_updated < ?`;
  const row = db.prepare(sql).get(from, to) as { n: number } | undefined;
  return row?.n ?? 0;
}
