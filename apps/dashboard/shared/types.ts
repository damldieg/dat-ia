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

/**
 * Usage rolled up over a set of sessions. Registered cost only: sessions
 * without a registered cost are counted apart and never added to `cost`.
 */
export interface UsageRollup {
  /** Sum of the registered cost values in the set. */
  cost: number;
  /** Sessions in the set whose cost is registered (including registered zero). */
  costKnownSessions: number;
  /** Sessions in the set with no registered cost (excluded from `cost`). */
  costUnavailableSessions: number;
  tokens: TokenUsage;
}

/** Subagent sessions of one task that ran on the same agent. */
export interface AgentRollupDTO {
  /** Agent name; `null` groups subagent sessions with no agent recorded. */
  agent: string | null;
  /** Number of subagent sessions (calls) that ran on this agent. */
  calls: number;
  /** `provider/model` keys those calls ran on, sorted. */
  models: string[];
  usage: UsageRollup;
}

/**
 * A task: one root (orchestrator) session with every subagent session below
 * it folded in. This is the unit the dashboard lists.
 */
export interface TaskDTO {
  /** The root session. Its own `cost`/`tokens` are the orchestrator's alone. */
  session: SessionDTO;
  /** Orchestrator + all subagent sessions. */
  total: UsageRollup;
  /** Subagent sessions only (every descendant, at any depth). */
  subagents: UsageRollup;
  /** Number of subagent sessions below the root, at any depth. */
  subagentCalls: number;
  /** Subagent sessions classified by agent, highest cost first. */
  agents: AgentRollupDTO[];
  /** Latest activity (epoch ms) anywhere in the task. */
  lastActivity: number;
}

/** Query filter accepted by `GET /api/tasks`. Same fields as sessions, minus `children`. */
export type TaskFilter = Omit<SessionFilter, 'children'>;

export interface TaskListDTO {
  tasks: TaskDTO[];
  total: number;
}

export interface TaskDetailDTO {
  task: TaskDTO;
  /** Every subagent session of the task, ordered by creation time (the call tree is built client-side). */
  calls: SessionDTO[];
}

/** A configured limit and how much of it is used. */
export interface BudgetLineDTO {
  /** `usd` compares registered cost; `tokens` compares input + output tokens. */
  unit: 'usd' | 'tokens';
  limit: number;
  used: number;
  /** `used / limit`; above 1 when the budget is exceeded. */
  ratio: number;
  /** Whether the limit comes from the model's own entry or from the default. */
  source: 'model' | 'default' | 'total';
}

export interface ModelBudgetDTO {
  /** `provider/model` key. */
  modelKey: string;
  /** Sessions (orchestrator or subagent) that ran on this model in the month. */
  sessions: number;
  cost: number;
  tokens: TokenUsage;
  /** `null` when no budget is configured for this model. */
  budget: BudgetLineDTO | null;
}

/** `GET /api/budgets` response: usage per model for one calendar month against the configured budgets. */
export interface BudgetsDTO {
  generatedAt: number;
  month: {
    /** `YYYY-MM`, in the local time zone of the machine running the adapter. */
    key: string;
    /** Inclusive start of the month (epoch ms). */
    from: number;
    /** Exclusive end of the month (epoch ms). */
    to: number;
    isCurrent: boolean;
    /** Share of the month already elapsed, 0..1 (1 for past months, 0 for future ones). */
    elapsedRatio: number;
  };
  total: {
    sessions: number;
    cost: number;
    tokens: TokenUsage;
    /** Overall monthly budget across all models, `null` when not configured. */
    budget: BudgetLineDTO | null;
  };
  /** One row per model with usage this month or with a budget of its own. */
  models: ModelBudgetDTO[];
  /** Sessions active in the month with no registered model (not attributable to any model). */
  sessionsWithoutModel: number;
  config: {
    /** File the budgets are read from. */
    path: string;
    status: 'ok' | 'missing' | 'invalid';
    /** Why the file was rejected when `status` is `invalid`. */
    message: string | null;
  };
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
