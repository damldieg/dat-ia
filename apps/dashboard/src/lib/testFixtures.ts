import type { SessionDTO, SummaryDTO } from '../../shared/types';

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
