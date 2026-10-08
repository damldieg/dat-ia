import type { BudgetsDTO, SessionDTO, SummaryDTO, TaskDTO, UsageRollup } from '../../shared/types';

/** Test-only session factory. Not imported by application code. */
export function makeSession(overrides: Partial<SessionDTO> & { id: string }): SessionDTO {
  return {
    parentId: null,
    projectId: 'proj-1',
    projectLabel: 'dat-ia',
    title: `Session ${overrides.id}`,
    directory: '/Users/dev/workspace/dat-ia',
    agent: 'general',
    model: { id: 'mimo-v2.6-flash-free', providerId: 'opencode', variant: null },
    modelKey: 'opencode/mimo-v2.6-flash-free',
    timeCreated: 1_790_000_000_000,
    timeUpdated: 1_790_000_100_000,
    tokens: { input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: { status: 'known', value: 0 },
    childCount: 0,
    ...overrides,
  };
}

/** Test-only summary factory. Not imported by application code. */
export function makeSummary(overrides: Partial<SummaryDTO> = {}): SummaryDTO {
  const base: SummaryDTO = {
    generatedAt: 1_790_000_200_000,
    sessions: { total: 5, roots: 3, children: 2 },
    cost: { knownTotal: 0.75, knownSessions: 4, zeroSessions: 2, unavailableSessions: 1 },
    tokens: { input: 123_412, output: 20_503, reasoning: 0, cacheRead: 5_463_040, cacheWrite: 982_333 },
    timeRange: { earliest: 1_790_000_000_000, latest: 1_790_000_500_000 },
    facets: {
      agents: [
        { value: 'general', label: 'general', count: 3 },
        { value: 'build', label: 'build', count: 2 },
      ],
      models: [{ value: 'opencode/mimo-v2.6-flash-free', label: 'opencode/mimo-v2.6-flash-free', count: 4 }],
      projects: [{ value: 'proj-1', label: 'dat-ia', count: 5 }],
    },
  };
  return { ...base, ...overrides };
}

const NO_USAGE: UsageRollup = {
  cost: 0,
  costKnownSessions: 0,
  costUnavailableSessions: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
};

/** Test-only task factory: a root session with two classified subagent groups. */
export function makeTask(overrides: Partial<TaskDTO> = {}): TaskDTO {
  const session = makeSession({
    id: 'ses_root',
    title: 'Add budget panel',
    agent: 'gentle-orchestrator',
    model: { id: 'gpt-6-luna', providerId: 'opencode-go', variant: 'medium' },
    modelKey: 'opencode-go/gpt-6-luna',
    cost: { status: 'known', value: 0.4 },
    tokens: { input: 12_000, output: 3_000, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    childCount: 2,
  });
  const base: TaskDTO = {
    session,
    total: {
      cost: 1.6,
      costKnownSessions: 4,
      costUnavailableSessions: 0,
      tokens: { input: 62_000, output: 13_000, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    },
    subagents: {
      cost: 1.2,
      costKnownSessions: 3,
      costUnavailableSessions: 0,
      tokens: { input: 50_000, output: 10_000, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    },
    subagentCalls: 3,
    agents: [
      {
        agent: 'sdd-apply',
        calls: 2,
        models: ['opencode-go/mimo-v2.6-flash'],
        usage: {
          cost: 0.9,
          costKnownSessions: 2,
          costUnavailableSessions: 0,
          tokens: { input: 40_000, output: 8_000, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        },
      },
      {
        agent: 'sdd-verify',
        calls: 1,
        models: ['opencode-go/mimo-v2.6-pro'],
        usage: {
          cost: 0.3,
          costKnownSessions: 1,
          costUnavailableSessions: 0,
          tokens: { input: 10_000, output: 2_000, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        },
      },
    ],
    lastActivity: 1_790_000_900_000,
  };
  return { ...base, ...overrides };
}

/** Test-only task with no subagent sessions at all. */
export function makeSoloTask(id = 'ses_solo'): TaskDTO {
  const session = makeSession({ id, title: 'Quick question' });
  return {
    session,
    total: { ...NO_USAGE, costKnownSessions: 1, tokens: session.tokens },
    subagents: NO_USAGE,
    subagentCalls: 0,
    agents: [],
    lastActivity: session.timeUpdated,
  };
}

/** Test-only budgets factory: one model per budget state plus one without a budget. */
export function makeBudgets(overrides: Partial<BudgetsDTO> = {}): BudgetsDTO {
  const tokens = { input: 1_000, output: 500, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  const base: BudgetsDTO = {
    generatedAt: 1_790_000_200_000,
    month: { key: '2026-10', from: 1_790_000_000_000, to: 1_792_000_000_000, isCurrent: true, elapsedRatio: 0.25 },
    total: {
      sessions: 12,
      cost: 37.5,
      tokens,
      budget: { unit: 'usd', limit: 60, used: 37.5, ratio: 0.625, source: 'total' },
    },
    models: [
      {
        modelKey: 'opencode-go/gpt-6-luna',
        sessions: 5,
        cost: 26,
        tokens,
        budget: { unit: 'usd', limit: 25, used: 26, ratio: 1.04, source: 'model' },
      },
      {
        modelKey: 'opencode-go/mimo-v2.6-pro',
        sessions: 3,
        cost: 8.5,
        tokens,
        budget: { unit: 'usd', limit: 10, used: 8.5, ratio: 0.85, source: 'model' },
      },
      {
        modelKey: 'opencode/mimo-v2.6-flash-free',
        sessions: 3,
        cost: 0,
        tokens,
        budget: { unit: 'tokens', limit: 50_000_000, used: 12_000_000, ratio: 0.24, source: 'model' },
      },
      { modelKey: 'opencode-go/mimo-v2.6-flash', sessions: 1, cost: 3, tokens, budget: null },
    ],
    sessionsWithoutModel: 0,
    config: { path: '/Users/dev/workspace/dat-ia/apps/dashboard/budgets.json', status: 'ok', message: null },
  };
  return { ...base, ...overrides };
}
