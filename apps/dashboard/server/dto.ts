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
  CostStatus,
  FacetCount,
  ModelRef,
  SessionDTO,
  SummaryDTO,
  TokenUsage,
} from '../shared/types.ts';
import type { FacetRow, ProjectFacetRow, SessionRow, SummaryRow } from './store.ts';

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
