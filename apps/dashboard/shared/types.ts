/**
 * Privacy-safe read model shared by the local API adapter and the SPA.
 *
 * These types describe the ONLY shapes that may cross the HTTP boundary.
 * They are an explicit allowlist: no account, credential, prompt, message,
 * event, share URL or raw metadata field may ever be added here.
 *
 * This file is types-only on purpose: both the Node adapter (native TypeScript)
 * and the Vite SPA import it, and type-only imports are erased at runtime.
 */

/** Cost as registered by OpenCode. `unavailable` means "not registered", never "zero". */
export type CostStatus =
  | { status: 'known'; value: number }
  | { status: 'unavailable'; reason: 'no-registered-model' };

export interface ModelRef {
  /** Model id, e.g. `mimo-v2.6-flash-free`. */
  id: string;
  /** Provider id, e.g. `opencode`. */
  providerId: string;
  /** Optional variant label, e.g. `low`. */
  variant: string | null;
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface SessionDTO {
  id: string;
  parentId: string | null;
  projectId: string;
  /** Short project label (project name, else worktree/directory basename). */
  projectLabel: string;
  title: string | null;
  /** Working directory of the session (local path). */
  directory: string;
  agent: string | null;
  model: ModelRef | null;
  /** `provider/model` key, `null` when no model is registered. */
  modelKey: string | null;
  timeCreated: number;
  timeUpdated: number;
  tokens: TokenUsage;
  cost: CostStatus;
  /** Number of direct child sessions. */
  childCount: number;
}

export type ChildrenMode = 'include' | 'only' | 'exclude';

/** Query filter accepted by `GET /api/sessions`. All fields are optional. */
export interface SessionFilter {
  /** Inclusive lower bound on `time_updated` (epoch milliseconds). */
  from?: number;
  /** Inclusive upper bound on `time_updated` (epoch milliseconds). */
  to?: number;
  agent?: string;
  model?: string;
  project?: string;
  children?: ChildrenMode;
  limit?: number;
  offset?: number;
}

export interface FacetCount {
  value: string;
  label: string;
  count: number;
}

export interface SummaryDTO {
  /** Epoch milliseconds of the response generation time. */
  generatedAt: number;
  sessions: {
    total: number;
    roots: number;
    children: number;
  };
  cost: {
    /** Sum of registered cost values only. */
    knownTotal: number;
    /** Sessions whose cost is registered (including registered zero). */
    knownSessions: number;
    /** Sessions with a registered cost of exactly zero (free model or no usage). */
    zeroSessions: number;
    /** Sessions with no registered cost: shown as "not available", never as 0. */
    unavailableSessions: number;
  };
  tokens: TokenUsage;
  timeRange: { earliest: number; latest: number } | null;
  facets: {
    agents: FacetCount[];
    models: FacetCount[];
    projects: FacetCount[];
  };
}

export interface SessionListDTO {
  sessions: SessionDTO[];
  total: number;
}

export interface SessionDetailDTO {
  session: SessionDTO;
  /** All descendants, ordered by creation time (the tree is built client-side). */
  descendants: SessionDTO[];
}

/** `GET /api/health` response: runtime status only, no environment values. */
export interface HealthDTO {
  ok: boolean;
  localOnly: boolean;
  readOnly: boolean;
  dbPath: string;
  dbExists: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { field: string; message: string; allowed?: string[] };
  };
}
