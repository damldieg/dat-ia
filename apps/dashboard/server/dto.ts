/**
 * Row-to-DTO mapping.
 *
 * The DTO is an explicit allowlist: every field is copied on purpose and no
 * row is spread into the response. Columns that are never selected (share_url,
 * metadata, permission, revert, summary_*, fork_*, path, slug, version) cannot
 * leak because they never reach this module.
 */
import { basename } from 'node:path';
import type {
  AgentRollupDTO,
  CostStatus,
  FacetCount,
  ModelRef,
  SessionDTO,
  SummaryDTO,
  TaskDTO,
  TokenUsage,
  UsageRollup,
} from '../shared/types.ts';
import type { AgentUsageRow, FacetRow, ProjectFacetRow, SessionRow, SummaryRow, TaskRow } from './store.ts';

export function toModelRef(modelJson: string | null): ModelRef | null {
  if (!modelJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(modelJson);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id.length > 0 ? record.id : null;
  const providerId =
    typeof record.providerID === 'string' && record.providerID.length > 0 ? record.providerID : null;
  if (!id || !providerId) return null;
  const variant = typeof record.variant === 'string' && record.variant.length > 0 ? record.variant : null;
  return { id, providerId, variant };
}

/**
 * Registered cost only: `unavailable` when no model is registered for the
 * session, because the schema stores `cost` as `NOT NULL DEFAULT 0` and a zero
 * without a registered model is indistinguishable from an unregistered cost.
 */
export function toCostStatus(model: ModelRef | null, cost: number): CostStatus {
  if (model === null) return { status: 'unavailable', reason: 'no-registered-model' };
  return { status: 'known', value: cost };
}

function toTokens(row: SessionRow): TokenUsage {
  return {
    input: row.tokens_input,
    output: row.tokens_output,
    reasoning: row.tokens_reasoning,
    cacheRead: row.tokens_cache_read,
    cacheWrite: row.tokens_cache_write,
  };
}

export function projectLabelOf(row: Pick<SessionRow, 'project_name' | 'project_worktree' | 'directory'>): string {
  const name = row.project_name?.trim();
  if (name) return name;
  const worktree = row.project_worktree?.trim();
  return basename(worktree || row.directory || '');
}

export function toSessionDTO(row: SessionRow): SessionDTO {
  const model = toModelRef(row.model_json);
  return {
    id: row.id,
    parentId: row.parent_id,
    projectId: row.project_id,
    projectLabel: projectLabelOf(row),
    title: row.title,
    directory: row.directory,
    agent: row.agent,
    model,
    modelKey: row.model_key,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    tokens: toTokens(row),
    cost: toCostStatus(model, row.cost),
    childCount: row.child_count,
  };
}

function toFacetCounts(rows: FacetRow[]): FacetCount[] {
  return rows.map((row) => ({ value: row.value, label: row.value, count: row.count }));
}

function toProjectFacets(rows: ProjectFacetRow[]): FacetCount[] {
  return rows.map((row) => ({
    value: row.id,
    label: projectLabelOf({ project_name: row.name, project_worktree: row.worktree, directory: row.worktree ?? '' }),
    count: row.count,
  }));
}

export function toSummaryDTO(
  row: SummaryRow,
  facets: { agents: FacetRow[]; models: FacetRow[]; projects: ProjectFacetRow[] },
): SummaryDTO {
  return {
    generatedAt: Date.now(),
    sessions: {
      total: row.total,
      roots: row.roots,
      children: row.total - row.roots,
    },
    cost: {
      knownTotal: row.cost_known_total,
      knownSessions: row.cost_zero + row.cost_positive,
      zeroSessions: row.cost_zero,
      unavailableSessions: row.cost_unavailable,
    },
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cacheRead: row.tokens_cache_read,
      cacheWrite: row.tokens_cache_write,
    },
    timeRange: row.earliest !== null && row.latest !== null ? { earliest: row.earliest, latest: row.latest } : null,
    facets: {
      agents: toFacetCounts(facets.agents),
      models: toFacetCounts(facets.models),
      projects: toProjectFacets(facets.projects),
    },
  };
}

/** Code-unit order: deterministic on every machine, unlike locale collation. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

function addUsage(a: UsageRollup, b: UsageRollup): UsageRollup {
  return {
    cost: a.cost + b.cost,
    costKnownSessions: a.costKnownSessions + b.costKnownSessions,
    costUnavailableSessions: a.costUnavailableSessions + b.costUnavailableSessions,
    tokens: addTokens(a.tokens, b.tokens),
  };
}

/** A single session expressed as a rollup, so it can be added to others. */
function usageOfSession(session: SessionDTO): UsageRollup {
  const known = session.cost.status === 'known';
  return {
    cost: session.cost.status === 'known' ? session.cost.value : 0,
    costKnownSessions: known ? 1 : 0,
    costUnavailableSessions: known ? 0 : 1,
    tokens: session.tokens,
  };
}

function usageOfAgentRow(row: AgentUsageRow): UsageRollup {
  return {
    cost: row.cost,
    costKnownSessions: row.cost_known,
    costUnavailableSessions: row.cost_unavailable,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cacheRead: row.tokens_cache_read,
      cacheWrite: row.tokens_cache_write,
    },
  };
}

/**
 * Classifies the subagent sessions of each task by agent. Input rows are
 * grouped by (task, agent, model); the result folds models into each agent and
 * sorts agents by cost, then tokens, then calls, then name.
 */
export function toAgentRollups(rows: AgentUsageRow[]): Map<string, AgentRollupDTO[]> {
  const byRoot = new Map<string, Map<string, AgentRollupDTO>>();
  for (const row of rows) {
    let agents = byRoot.get(row.root_id);
    if (!agents) {
      agents = new Map();
      byRoot.set(row.root_id, agents);
    }
    // `\u0000` cannot appear in an agent name, so it is a safe key for "no agent".
    const key = row.agent ?? '\u0000';
    const usage = usageOfAgentRow(row);
    const existing = agents.get(key);
    if (existing) {
      existing.calls += row.calls;
      existing.usage = addUsage(existing.usage, usage);
      if (row.model_key && !existing.models.includes(row.model_key)) existing.models.push(row.model_key);
    } else {
      agents.set(key, {
        agent: row.agent,
        calls: row.calls,
        models: row.model_key ? [row.model_key] : [],
        usage,
      });
    }
  }

  const result = new Map<string, AgentRollupDTO[]>();
  for (const [rootId, agents] of byRoot) {
    const list = [...agents.values()];
    for (const entry of list) entry.models.sort();
    list.sort(
      (a, b) =>
        b.usage.cost - a.usage.cost ||
        b.usage.tokens.input + b.usage.tokens.output - (a.usage.tokens.input + a.usage.tokens.output) ||
        b.calls - a.calls ||
        compareText(a.agent ?? '', b.agent ?? ''),
    );
    result.set(rootId, list);
  }
  return result;
}

export function toTaskDTO(row: TaskRow, agents: AgentRollupDTO[]): TaskDTO {
  const session = toSessionDTO(row);
  const subagents: UsageRollup = {
    cost: row.sub_cost,
    costKnownSessions: row.sub_cost_known,
    costUnavailableSessions: row.sub_cost_unavailable,
    tokens: {
      input: row.sub_tokens_input,
      output: row.sub_tokens_output,
      reasoning: row.sub_tokens_reasoning,
      cacheRead: row.sub_tokens_cache_read,
      cacheWrite: row.sub_tokens_cache_write,
    },
  };
  return {
    session,
    total: addUsage(usageOfSession(session), subagents),
    subagents,
    subagentCalls: row.sub_calls,
    agents,
    lastActivity: row.last_activity,
  };
}
