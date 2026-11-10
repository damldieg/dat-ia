import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApiHandler } from './app.ts';
import { currentBillingWindow } from './budgets.ts';

/**
 * End-to-end test of the read-only adapter over a fixture database that uses
 * the real OpenCode column names — including columns that must never leak.
 */

const FORBIDDEN_MARKERS = [
  'LEAK_SHARE_URL',
  'LEAK_METADATA',
  'LEAK_PERMISSION',
  'LEAK_REVERT',
  'LEAK_DIFFS',
  'LEAK_SLUG',
  'LEAK_PATH',
  'LEAK_FORK',
  'LEAK_SUMMARY_FILES',
];

const FORBIDDEN_KEYS = ['share_url', 'metadata', 'permission', 'revert', 'summary_diffs', 'slug', 'fork_session_id'];

const T0 = 1_790_000_000_000;
const MINUTE = 60_000;

let workDir = '';
let dbPath = '';
let budgetsPath = '';
let server: Server;
let baseUrl = '';

function createFixtureDb(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      worktree TEXT NOT NULL,
      name TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      fork_session_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      path TEXT,
      title TEXT,
      version TEXT NOT NULL,
      share_url TEXT,
      summary_files INTEGER,
      summary_diffs TEXT,
      metadata TEXT,
      cost REAL DEFAULT 0 NOT NULL,
      tokens_input INTEGER DEFAULT 0 NOT NULL,
      tokens_output INTEGER DEFAULT 0 NOT NULL,
      tokens_reasoning INTEGER DEFAULT 0 NOT NULL,
      tokens_cache_read INTEGER DEFAULT 0 NOT NULL,
      tokens_cache_write INTEGER DEFAULT 0 NOT NULL,
      revert TEXT,
      permission TEXT,
      agent TEXT,
      model TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
  `);

  db.prepare('INSERT INTO project (id, worktree, name, time_created, time_updated) VALUES (?, ?, ?, ?, ?)').run(
    'proj-dat-ia',
    '/Users/dev/workspace/dat-ia',
    'dat-ia',
    T0,
    T0,
  );
  db.prepare('INSERT INTO project (id, worktree, name, time_created, time_updated) VALUES (?, ?, ?, ?, ?)').run(
    'proj-other',
    '/Users/dev/workspace/other-project',
    null,
    T0,
    T0,
  );

  const insert = db.prepare(`
    INSERT INTO session_v2 (
      id, project_id, parent_id, fork_session_id, slug, directory, path, title, version,
      share_url, summary_files, summary_diffs, metadata, cost,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
      revert, permission, agent, model, time_created, time_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const leaks = {
    fork: 'LEAK_FORK',
    slug: 'LEAK_SLUG',
    path: 'LEAK_PATH',
    share: 'LEAK_SHARE_URL',
    files: 7,
    diffs: 'LEAK_DIFFS',
    meta: '{"apiKey":"LEAK_METADATA"}',
    revert: 'LEAK_REVERT',
    permission: 'LEAK_PERMISSION',
  };

  // Root A: free model, registered zero cost, one direct child.
  insert.run(
    'ses_root_a',
    'proj-dat-ia',
    null,
    leaks.fork,
    leaks.slug,
    '/Users/dev/workspace/dat-ia',
    leaks.path,
    'Root session A',
    '2.0.19',
    leaks.share,
    leaks.files,
    leaks.diffs,
    leaks.meta,
    0,
    8562,
    22,
    0,
    546304,
    0,
    leaks.revert,
    leaks.permission,
    'general',
    '{"id":"mimo-v2.6-flash-free","providerID":"opencode"}',
    T0,
    T0 + 10 * MINUTE,
  );

  // Child B: paid model, registered non-zero cost.
  insert.run(
    'ses_child_b',
    'proj-dat-ia',
    'ses_root_a',
    null,
    'slug-b',
    '/Users/dev/workspace/dat-ia',
    null,
    'Child session B',
    '2.0.19',
    null,
    null,
    null,
    null,
    0.5,
    109_313,
    19_984,
    0,
    7_471_110,
    982_333,
    null,
    null,
    'gentle-orchestrator',
    '{"id":"gpt-5.6-luna","providerID":"opencode-go","variant":"medium"}',
    T0 + MINUTE,
    T0 + 20 * MINUTE,
  );

  // Grandchild C: proves the recursive descendant query.
  insert.run(
    'ses_grandchild_c',
    'proj-dat-ia',
    'ses_child_b',
    null,
    'slug-c',
    '/Users/dev/workspace/dat-ia',
    null,
    'Grandchild session C',
    '2.0.19',
    null,
    null,
    null,
    null,
    0.25,
    1000,
    200,
    0,
    0,
    0,
    null,
    null,
    'general',
    '{"id":"grok-4.7","providerID":"opencode-go","variant":"xhigh"}',
    T0 + 2 * MINUTE,
    T0 + 30 * MINUTE,
  );

  // Root D: usage recorded but no model registered -> cost unavailable.
  insert.run(
    'ses_root_d',
    'proj-other',
    null,
    null,
    'slug-d',
    '/Users/dev/workspace/other-project',
    null,
    null,
    '2.0.19',
    null,
    null,
    null,
    null,
    0,
    4537,
    247,
    0,
    0,
    0,
    null,
    null,
    'build',
    null,
    T0 + 3 * MINUTE,
    T0 + 40 * MINUTE,
  );

  // Root E: brand-new session, registered model, no usage yet.
  insert.run(
    'ses_root_e',
    'proj-other',
    null,
    null,
    'slug-e',
    '/Users/dev/workspace/other-project',
    null,
    'Root session E',
    '2.0.19',
    null,
    null,
    null,
    null,
    0,
    0,
    0,
    0,
    0,
    0,
    null,
    null,
    'build',
    '{"id":"space-bunny-free","providerID":"opencode-go","variant":"low"}',
    T0 + 4 * MINUTE,
    T0 + 50 * MINUTE,
  );

  db.close();
}

function assertNoLeaks(body: string): void {
  for (const marker of FORBIDDEN_MARKERS) {
    assert.ok(!body.includes(marker), `response leaked ${marker}`);
  }
  for (const key of FORBIDDEN_KEYS) {
    assert.ok(!body.includes(`"${key}"`), `response leaked key "${key}"`);
  }
}

async function getJson(pathname: string): Promise<{ status: number; body: unknown; raw: string }> {
  const response = await fetch(`${baseUrl}${pathname}`);
  const raw = await response.text();
  assertNoLeaks(raw);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  return { status: response.status, body, raw };
}

before(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'session-dashboard-'));
  dbPath = path.join(workDir, 'opencode.db');
  createFixtureDb(dbPath);
  budgetsPath = path.join(workDir, 'budgets.json');
  writeFileSync(
    budgetsPath,
    JSON.stringify({
      totalMonthlyUsd: 3,
      models: {
        'opencode-go/gpt-5.6-luna': { monthlyUsd: 1 },
        'opencode/mimo-v2.6-flash-free': { monthlyTokens: 10_000 },
        'opencode-go/unused-model': { monthlyUsd: 5 },
      },
    }),
  );
  server = createServer(createApiHandler({ dbPath, budgetsPath }));
  return new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(() => {
  return new Promise<void>((resolve) => {
    server.close(() => {
      rmSync(workDir, { recursive: true, force: true });
      resolve();
    });
  });
});

test('health reports the configured database without exposing environment values', async () => {
  const { status, body } = await getJson('/api/health');
  assert.equal(status, 200);
  const health = body as { ok: boolean; localOnly: boolean; readOnly: boolean; dbPath: string; dbExists: boolean };
  assert.equal(health.ok, true);
  assert.equal(health.localOnly, true);
  assert.equal(health.readOnly, true);
  assert.equal(health.dbExists, true);
  assert.equal(health.dbPath, dbPath);
});

test('summary aggregates sessions, registered cost and facets', async () => {
  const { status, body } = await getJson('/api/summary');
  assert.equal(status, 200);
  const summary = body as {
    sessions: { total: number; roots: number; children: number };
    cost: { knownTotal: number; knownSessions: number; zeroSessions: number; unavailableSessions: number };
    tokens: { input: number; output: number };
    facets: { agents: { value: string; count: number }[]; models: { value: string; count: number }[]; projects: { value: string; label: string }[] };
    timeRange: { earliest: number; latest: number } | null;
  };

  assert.equal(summary.sessions.total, 5);
  assert.equal(summary.sessions.roots, 3);
  assert.equal(summary.sessions.children, 2);
  assert.equal(summary.cost.knownTotal, 0.75, 'only registered cost values are summed');
  assert.equal(summary.cost.knownSessions, 4);
  assert.equal(summary.cost.zeroSessions, 2);
  assert.equal(summary.cost.unavailableSessions, 1);
  assert.equal(summary.tokens.input, 8562 + 109_313 + 1000 + 4537);
  assert.equal(summary.timeRange?.earliest, T0);
  assert.equal(summary.timeRange?.latest, T0 + 50 * MINUTE);
  assert.deepEqual(
    summary.facets.models.map((facet) => facet.value),
    // Tied counts sort by model key ascending: `opencode-go/...` before `opencode/...`.
    ['opencode-go/gpt-5.6-luna', 'opencode-go/grok-4.7', 'opencode-go/space-bunny-free', 'opencode/mimo-v2.6-flash-free'],
  );
  assert.deepEqual(
    summary.facets.projects.map((facet) => facet.label),
    ['dat-ia', 'other-project'],
  );
});

test('session list is ordered by activity and carries child counts', async () => {
  const { status, body } = await getJson('/api/sessions');
  assert.equal(status, 200);
  const list = body as { sessions: { id: string; childCount: number; title: string | null }[]; total: number };
  assert.equal(list.total, 5);
  assert.deepEqual(
    list.sessions.map((session) => session.id),
    ['ses_root_e', 'ses_root_d', 'ses_grandchild_c', 'ses_child_b', 'ses_root_a'],
  );
  const rootA = list.sessions.find((session) => session.id === 'ses_root_a');
  assert.equal(rootA?.childCount, 1);
  const childB = list.sessions.find((session) => session.id === 'ses_child_b');
  assert.equal(childB?.childCount, 1);
  const rootD = list.sessions.find((session) => session.id === 'ses_root_d');
  assert.equal(rootD?.title, null, 'null titles pass through as null');
});

test('child filter distinguishes roots from child sessions', async () => {
  const only = (await getJson('/api/sessions?children=only')).body as { sessions: { id: string }[] };
  assert.deepEqual(
    only.sessions.map((session) => session.id).sort(),
    ['ses_child_b', 'ses_grandchild_c'],
  );

  const exclude = (await getJson('/api/sessions?children=exclude')).body as { sessions: { id: string }[] };
  assert.deepEqual(
    exclude.sessions.map((session) => session.id).sort(),
    ['ses_root_a', 'ses_root_d', 'ses_root_e'],
  );
});

test('agent, model, project and time-range filters narrow the result set', async () => {
  const byAgent = (await getJson('/api/sessions?agent=build')).body as { sessions: { id: string }[] };
  assert.deepEqual(
    byAgent.sessions.map((session) => session.id).sort(),
    ['ses_root_d', 'ses_root_e'],
  );

  const byModel = (await getJson('/api/sessions?model=opencode%2Fmimo-v2.6-flash-free')).body as {
    sessions: { id: string }[];
  };
  assert.deepEqual(
    byModel.sessions.map((session) => session.id),
    ['ses_root_a'],
  );

  const byProject = (await getJson('/api/sessions?project=proj-other')).body as { sessions: { id: string }[] };
  assert.deepEqual(
    byProject.sessions.map((session) => session.id).sort(),
    ['ses_root_d', 'ses_root_e'],
  );

  const byRange = (await getJson(`/api/sessions?from=${T0 + 15 * MINUTE}&to=${T0 + 25 * MINUTE}`)).body as {
    sessions: { id: string }[];
    total: number;
  };
  assert.equal(byRange.total, 1);
  assert.deepEqual(
    byRange.sessions.map((session) => session.id),
    ['ses_child_b'],
  );

  const paged = (await getJson('/api/sessions?limit=2&offset=1')).body as { sessions: unknown[]; total: number };
  assert.equal(paged.sessions.length, 2);
  assert.equal(paged.total, 5);
});

test('cost states are known zero, known non-zero or unavailable', async () => {
  const { body } = await getJson('/api/sessions?limit=50');
  const list = body as { sessions: { id: string; cost: { status: string; value?: number } }[] };
  const byId = new Map(list.sessions.map((session) => [session.id, session.cost]));
  assert.deepEqual(byId.get('ses_root_a'), { status: 'known', value: 0 });
  assert.deepEqual(byId.get('ses_child_b'), { status: 'known', value: 0.5 });
  assert.deepEqual(byId.get('ses_root_d'), { status: 'unavailable', reason: 'no-registered-model' });
  assert.deepEqual(byId.get('ses_root_e'), { status: 'known', value: 0 });
});

test('detail returns the session with its full descendant tree', async () => {
  const { status, body } = await getJson('/api/sessions/ses_root_a');
  assert.equal(status, 200);
  const detail = body as { session: { id: string; cost: { status: string } }; descendants: { id: string; parentId: string | null }[] };
  assert.equal(detail.session.id, 'ses_root_a');
  assert.deepEqual(
    detail.descendants.map((node) => node.id),
    ['ses_child_b', 'ses_grandchild_c'],
  );
  assert.equal(detail.descendants[0]?.parentId, 'ses_root_a');
  assert.equal(detail.descendants[1]?.parentId, 'ses_child_b');
});

test('detail of a leaf session returns an empty descendant list', async () => {
  const { status, body } = await getJson('/api/sessions/ses_grandchild_c');
  assert.equal(status, 200);
  const detail = body as { descendants: unknown[] };
  assert.deepEqual(detail.descendants, []);
});

test('invalid parameters answer 400 with the offending field', async () => {
  const cases: [string, string][] = [
    ['/api/sessions?children=maybe', 'children'],
    ['/api/sessions?limit=9999', 'limit'],
    ['/api/sessions?from=notanumber', 'from'],
    ['/api/sessions?from=5000&to=1000', 'from'],
  ];
  for (const [pathname, field] of cases) {
    const { status, body } = await getJson(pathname);
    assert.equal(status, 400, `expected 400 for ${pathname}`);
    const error = body as { error: { code: string; details?: { field: string } } };
    assert.equal(error.error.code, 'invalid-parameter');
    assert.equal(error.error.details?.field, field);
  }
});

test('malformed or unknown session ids answer 400 or 404, never 500', async () => {
  const malformed = await getJson('/api/sessions/..%2F..%2Fetc%2Fpasswd');
  assert.equal(malformed.status, 400);
  const malformedBody = malformed.body as { error: { code: string } };
  assert.equal(malformedBody.error.code, 'invalid-session-id');

  const missing = await getJson('/api/sessions/ses_does_not_exist');
  assert.equal(missing.status, 404);
  const missingBody = missing.body as { error: { code: string } };
  assert.equal(missingBody.error.code, 'session-not-found');
});

test('unknown routes and non-GET methods are rejected as JSON', async () => {
  const route = await getJson('/api/nope');
  assert.equal(route.status, 404);
  const routeBody = route.body as { error: { code: string } };
  assert.equal(routeBody.error.code, 'route-not-found');

  const response = await fetch(`${baseUrl}/api/sessions`, { method: 'POST' });
  const raw = await response.text();
  assertNoLeaks(raw);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});

test('a missing database answers 503 instead of crashing', async () => {
  const missingServer = createServer(createApiHandler({ dbPath: path.join(workDir, 'missing.db') }));
  await new Promise<void>((resolve) => {
    missingServer.listen(0, '127.0.0.1', () => resolve());
  });
  const address = missingServer.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/summary`);
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'db-not-found');
  await new Promise<void>((resolve) => {
    missingServer.close(() => resolve());
  });
});

/* ------------------------------------------------------------------------- *
 * Tasks: root sessions with their subagent sessions rolled up.
 * ------------------------------------------------------------------------- */

interface UsageBody {
  cost: number;
  costKnownSessions: number;
  costUnavailableSessions: number;
  tokens: { input: number; output: number; cacheRead: number };
}

interface TaskBody {
  session: { id: string; parentId: string | null; cost: { status: string; value?: number } };
  total: UsageBody;
  subagents: UsageBody;
  subagentCalls: number;
  agents: { agent: string | null; calls: number; models: string[]; usage: UsageBody }[];
  lastActivity: number;
}

/** Spins up a second adapter over its own database/budgets/limits files. */
async function withServer<T>(
  options: { dbPath: string; budgetsPath: string; limitsPath?: string },
  run: (url: string) => Promise<T>,
): Promise<T> {
  const extra = createServer(createApiHandler(options));
  await new Promise<void>((resolve) => {
    extra.listen(0, '127.0.0.1', () => resolve());
  });
  const address = extra.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => {
      extra.close(() => resolve());
    });
  }
}

test('task list shows one row per root session, never a subagent session', async () => {
  const { status, body } = await getJson('/api/tasks');
  assert.equal(status, 200);
  const list = body as { tasks: TaskBody[]; total: number };
  assert.equal(list.total, 3);
  assert.deepEqual(
    list.tasks.map((task) => task.session.id),
    // Ordered by the latest activity anywhere in the task: root A is last touched by its grandchild.
    ['ses_root_e', 'ses_root_d', 'ses_root_a'],
  );
  assert.ok(list.tasks.every((task) => task.session.parentId === null));
});

test('subagent sessions are rolled up into their root session at any depth', async () => {
  const { body } = await getJson('/api/tasks');
  const list = body as { tasks: TaskBody[] };
  const rootA = list.tasks.find((task) => task.session.id === 'ses_root_a');
  assert.ok(rootA);

  assert.equal(rootA.subagentCalls, 2, 'child and grandchild both count');
  assert.equal(rootA.lastActivity, T0 + 30 * MINUTE);
  assert.deepEqual(rootA.session.cost, { status: 'known', value: 0 }, 'the root keeps its own cost');
  assert.equal(rootA.subagents.cost, 0.75);
  assert.equal(rootA.subagents.costKnownSessions, 2);
  assert.equal(rootA.subagents.tokens.input, 109_313 + 1000);
  assert.equal(rootA.total.cost, 0.75);
  assert.equal(rootA.total.costKnownSessions, 3);
  assert.equal(rootA.total.costUnavailableSessions, 0);
  assert.equal(rootA.total.tokens.input, 8562 + 109_313 + 1000);
  assert.equal(rootA.total.tokens.output, 22 + 19_984 + 200);
  assert.equal(rootA.total.tokens.cacheRead, 546_304 + 7_471_110);
});

test('subagent sessions are classified by agent, highest cost first', async () => {
  const { body } = await getJson('/api/tasks');
  const list = body as { tasks: TaskBody[] };
  const rootA = list.tasks.find((task) => task.session.id === 'ses_root_a');
  assert.ok(rootA);
  assert.deepEqual(
    rootA.agents.map((entry) => [entry.agent, entry.calls, entry.usage.cost, entry.models]),
    [
      ['gentle-orchestrator', 1, 0.5, ['opencode-go/gpt-5.6-luna']],
      ['general', 1, 0.25, ['opencode-go/grok-4.7']],
    ],
  );

  const rootE = list.tasks.find((task) => task.session.id === 'ses_root_e');
  assert.equal(rootE?.subagentCalls, 0);
  assert.deepEqual(rootE?.agents, []);
});

test('a task without a registered model keeps its cost unavailable instead of zero', async () => {
  const { body } = await getJson('/api/tasks');
  const list = body as { tasks: TaskBody[] };
  const rootD = list.tasks.find((task) => task.session.id === 'ses_root_d');
  assert.ok(rootD);
  assert.equal(rootD.total.costKnownSessions, 0);
  assert.equal(rootD.total.costUnavailableSessions, 1);
  assert.equal(rootD.total.cost, 0);
  assert.equal(rootD.total.tokens.input, 4537);
});

test('task filters match on any session of the task', async () => {
  const ids = async (query: string) =>
    ((await getJson(`/api/tasks${query}`)).body as { tasks: TaskBody[] }).tasks.map((task) => task.session.id);

  assert.deepEqual(await ids('?agent=gentle-orchestrator'), ['ses_root_a'], 'agent used by a subagent');
  assert.deepEqual(await ids('?agent=build'), ['ses_root_e', 'ses_root_d'], 'agent of the root itself');
  assert.deepEqual(await ids('?model=opencode-go%2Fgrok-4.7'), ['ses_root_a'], 'model used by a grandchild');
  assert.deepEqual(await ids('?project=proj-other'), ['ses_root_e', 'ses_root_d']);
  assert.deepEqual(
    await ids(`?from=${T0 + 25 * MINUTE}&to=${T0 + 35 * MINUTE}`),
    ['ses_root_a'],
    'time range applies to the latest activity in the task, not to the root row',
  );

  const paged = (await getJson('/api/tasks?limit=1&offset=1')).body as { tasks: TaskBody[]; total: number };
  assert.deepEqual(
    paged.tasks.map((task) => task.session.id),
    ['ses_root_d'],
  );
  assert.equal(paged.total, 3);

  const invalid = await getJson('/api/tasks?limit=0');
  assert.equal(invalid.status, 400);
});

test('task detail lists every subagent call and resolves a subagent id to its task', async () => {
  for (const id of ['ses_root_a', 'ses_child_b', 'ses_grandchild_c']) {
    const { status, body } = await getJson(`/api/tasks/${id}`);
    assert.equal(status, 200, `detail for ${id}`);
    const detail = body as { task: TaskBody; calls: { id: string; parentId: string | null; agent: string | null }[] };
    assert.equal(detail.task.session.id, 'ses_root_a');
    assert.equal(detail.task.subagentCalls, 2);
    assert.equal(detail.task.total.cost, 0.75);
    assert.equal(detail.task.agents.length, 2);
    assert.deepEqual(
      detail.calls.map((call) => [call.id, call.parentId, call.agent]),
      [
        ['ses_child_b', 'ses_root_a', 'gentle-orchestrator'],
        ['ses_grandchild_c', 'ses_child_b', 'general'],
      ],
    );
  }

  const leaf = (await getJson('/api/tasks/ses_root_e')).body as { task: TaskBody; calls: unknown[] };
  assert.equal(leaf.task.subagentCalls, 0);
  assert.deepEqual(leaf.calls, []);
});

test('task detail rejects malformed ids and unknown sessions', async () => {
  const malformed = await getJson('/api/tasks/..%2F..%2Fetc%2Fpasswd');
  assert.equal(malformed.status, 400);
  assert.equal((malformed.body as { error: { code: string } }).error.code, 'invalid-session-id');

  const missing = await getJson('/api/tasks/ses_does_not_exist');
  assert.equal(missing.status, 404);
  assert.equal((missing.body as { error: { code: string } }).error.code, 'session-not-found');
});

test('a session whose parent row is missing becomes its own task', async () => {
  const orphanDb = path.join(workDir, 'orphan.db');
  copyFileSync(dbPath, orphanDb);
  const db = new DatabaseSync(orphanDb);
  db.prepare(
    `INSERT INTO session_v2 (id, project_id, parent_id, slug, directory, title, version, cost, agent, model, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'ses_orphan',
    'proj-dat-ia',
    'ses_deleted_parent',
    'slug-orphan',
    '/Users/dev/workspace/dat-ia',
    'Orphan session',
    '2.0.19',
    0.1,
    'general',
    '{"id":"grok-4.7","providerID":"opencode-go"}',
    T0 + 55 * MINUTE,
    T0 + 60 * MINUTE,
  );
  db.close();

  await withServer({ dbPath: orphanDb, budgetsPath }, async (url) => {
    const list = (await (await fetch(`${url}/api/tasks`)).json()) as { tasks: TaskBody[]; total: number };
    assert.equal(list.total, 4);
    assert.equal(list.tasks[0]?.session.id, 'ses_orphan');
    assert.equal(list.tasks[0]?.total.cost, 0.1);

    const detail = (await (await fetch(`${url}/api/tasks/ses_orphan`)).json()) as { task: TaskBody };
    assert.equal(detail.task.session.id, 'ses_orphan');
  });
});

/* ------------------------------------------------------------------------- *
 * Budgets: usage per model for a calendar month.
 * ------------------------------------------------------------------------- */

interface BudgetLineBody {
  unit: string;
  limit: number;
  used: number;
  ratio: number;
  source: string;
}

interface BudgetsBody {
  month: { key: string; from: number; to: number; isCurrent: boolean; elapsedRatio: number };
  total: { sessions: number; cost: number; budget: BudgetLineBody | null };
  models: {
    modelKey: string;
    sessions: number;
    cost: number;
    budget: BudgetLineBody | null;
    plan: { id: string; monthlyUsd: number | null } | null;
    cost5h: number;
    cost7d: number;
  }[];
  sessionsWithoutModel: number;
  config: { path: string; status: string; message: string | null };
  snapshot: { source: string | null; capturedAt: string | null; status: string; message: string | null };
}

function monthKeyOf(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const FIXTURE_MONTH = monthKeyOf(T0);

test('budgets report usage per model for the month against the configured limits', async () => {
  const { status, body } = await getJson(`/api/budgets?month=${FIXTURE_MONTH}`);
  assert.equal(status, 200);
  const budgets = body as BudgetsBody;

  assert.equal(budgets.month.key, FIXTURE_MONTH);
  assert.equal(budgets.month.isCurrent, false);
  assert.equal(budgets.month.elapsedRatio, 1, 'a past month is fully elapsed');
  assert.equal(budgets.config.status, 'ok');
  assert.equal(budgets.config.path, budgetsPath);

  assert.equal(budgets.total.cost, 0.75);
  assert.equal(budgets.total.sessions, 4);
  assert.deepEqual(budgets.total.budget, { unit: 'usd', limit: 3, used: 0.75, ratio: 0.25, source: 'total' });
  assert.equal(budgets.sessionsWithoutModel, 1);

  assert.deepEqual(
    budgets.models.map((model) => model.modelKey),
    [
      // Budgeted models first, closest to the limit on top…
      'opencode/mimo-v2.6-flash-free',
      'opencode-go/gpt-5.6-luna',
      'opencode-go/unused-model',
      // …then models without a budget, by spend.
      'opencode-go/grok-4.7',
      'opencode-go/space-bunny-free',
    ],
  );

  const byKey = new Map(budgets.models.map((model) => [model.modelKey, model]));
  assert.deepEqual(byKey.get('opencode-go/gpt-5.6-luna')?.budget, {
    unit: 'usd',
    limit: 1,
    used: 0.5,
    ratio: 0.5,
    source: 'model',
  });
  assert.deepEqual(byKey.get('opencode/mimo-v2.6-flash-free')?.budget, {
    unit: 'tokens',
    limit: 10_000,
    used: 8562 + 22,
    ratio: (8562 + 22) / 10_000,
    source: 'model',
  });
  assert.equal(byKey.get('opencode-go/unused-model')?.sessions, 0);
  assert.equal(byKey.get('opencode-go/unused-model')?.budget?.ratio, 0);
  assert.equal(byKey.get('opencode-go/grok-4.7')?.budget, null);
  assert.equal(byKey.get('opencode-go/grok-4.7')?.cost, 0.25);
});

test('a month without activity reports budgets with no usage', async () => {
  const { status, body } = await getJson('/api/budgets?month=2020-01');
  assert.equal(status, 200);
  const budgets = body as BudgetsBody;
  assert.equal(budgets.total.cost, 0);
  assert.equal(budgets.total.sessions, 0);
  assert.equal(budgets.sessionsWithoutModel, 0);
  assert.deepEqual(
    budgets.models.map((model) => [model.modelKey, model.cost]),
    [
      ['opencode-go/gpt-5.6-luna', 0],
      ['opencode-go/unused-model', 0],
      ['opencode/mimo-v2.6-flash-free', 0],
    ],
  );
});

test('budgets default to the current month and validate the month parameter', async () => {
  const current = (await getJson('/api/budgets')).body as BudgetsBody;
  assert.equal(current.month.key, monthKeyOf(Date.now()));
  assert.equal(current.month.isCurrent, true);
  assert.ok(current.month.elapsedRatio > 0 && current.month.elapsedRatio < 1);

  for (const value of ['2026-13', '26-10', 'october', '2026-10-01']) {
    const { status, body } = await getJson(`/api/budgets?month=${value}`);
    assert.equal(status, 400, `expected 400 for month=${value}`);
    assert.equal((body as { error: { details?: { field: string } } }).error.details?.field, 'month');
  }
});

test('a missing or invalid budgets file still returns usage, with the reason', async () => {
  const missing = await withServer({ dbPath, budgetsPath: path.join(workDir, 'no-budgets.json') }, async (url) => {
    return (await (await fetch(`${url}/api/budgets?month=${FIXTURE_MONTH}`)).json()) as BudgetsBody;
  });
  assert.equal(missing.config.status, 'missing');
  assert.equal(missing.total.cost, 0.75);
  assert.equal(missing.total.budget, null);
  assert.ok(missing.models.every((model) => model.budget === null));
  assert.equal(missing.models.length, 4, 'only models with usage are listed');

  const brokenPath = path.join(workDir, 'broken-budgets.json');
  writeFileSync(brokenPath, '{ "models": { "opencode-go/gpt-5.6-luna": { "monthlyUsd": -4 } } }');
  const broken = await withServer({ dbPath, budgetsPath: brokenPath }, async (url) => {
    return (await (await fetch(`${url}/api/budgets?month=${FIXTURE_MONTH}`)).json()) as BudgetsBody;
  });
  assert.equal(broken.config.status, 'invalid');
  assert.match(broken.config.message ?? '', /monthlyUsd must be a positive number/);
  assert.equal(broken.total.cost, 0.75);
  assert.ok(broken.models.every((model) => model.budget === null));
});

/* ------------------------------------------------------------------------- *
 * Budgets: plan limits, billingDay windows and rolling aggregates.
 * ------------------------------------------------------------------------- */

/**
 * Dedicated fixture: a copy of the main database plus sessions pinned to the
 * clock — `now-1h`/`now-3d`/`now-10d` for the rolling aggregates and one
 * session inside the current billing window so its row exists regardless of
 * where the cycle boundaries fall. Aggregate models carry manual entries for
 * the same reason.
 */
function setupPlanFixture(suffix: string): { planDb: string; planBudgetsPath: string; planLimitsPath: string } {
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const now = Date.now();
  const window = currentBillingWindow(now, 15);
  const inWindow = Math.max(window.from, now - MINUTE);

  const planDb = path.join(workDir, `plan-${suffix}.db`);
  copyFileSync(dbPath, planDb);
  const db = new DatabaseSync(planDb);
  const insert = db.prepare(`
    INSERT INTO session_v2 (id, project_id, parent_id, slug, directory, title, version, cost, agent, model, time_created, time_updated)
    VALUES (?, 'proj-dat-ia', NULL, ?, '/Users/dev/workspace/dat-ia', ?, '2.0.19', ?, 'general', ?, ?, ?)
  `);
  const session = (id: string, model: string, cost: number, at: number) => insert.run(id, `slug-${id}`, id, cost, model, at, at);
  session('ses_plan_1h', '{"id":"mimo-v2.6-pro","providerID":"opencode-go"}', 1, now - HOUR);
  session('ses_plan_3d', '{"id":"mimo-v2.6-pro","providerID":"opencode-go"}', 2, now - 3 * DAY);
  session('ses_plan_10d', '{"id":"mimo-v2.6-pro","providerID":"opencode-go"}', 4, now - 10 * DAY);
  session('ses_plan_glm_1h', '{"id":"glm-5.2","providerID":"opencode-go"}', 0.25, now - HOUR);
  session('ses_plan_glm_3d', '{"id":"glm-5.2","providerID":"opencode-go"}', 0.75, now - 3 * DAY);
  // Under a plan but not in the snapshot and without a manual entry.
  session('ses_plan_open', '{"id":"minimax-m2.5","providerID":"opencode-go"}', 1.5, inWindow);
  // Outside opencode-go: proves the default is configured and in force.
  session('ses_plan_default', '{"id":"free-tier","providerID":"opencode"}', 0.5, inWindow);
  db.close();

  const planBudgetsPath = path.join(workDir, `plan-budgets-${suffix}.json`);
  writeFileSync(
    planBudgetsPath,
    JSON.stringify({
      plan: 'go',
      billingDay: 15,
      defaultMonthlyUsd: 7,
      models: {
        'opencode-go/mimo-v2.6-pro': { monthlyUsd: 20 },
        'opencode-go/glm-5.2': { monthlyUsd: 30 },
      },
    }),
  );

  const planLimitsPath = path.join(workDir, `plan-limits-${suffix}.json`);
  writeFileSync(
    planLimitsPath,
    JSON.stringify({
      source: 'https://opencode.ai/docs/go/',
      capturedAt: '2026-10-08',
      plans: {
        go: { label: 'OpenCode Go', models: { 'mimo-v2.6-pro': { monthlyUsd: 15 }, 'glm-5.2': { monthlyUsd: 60 } } },
        'go-plus': { label: 'OpenCode Go Plus', models: { 'mimo-v2.6-pro': { monthlyUsd: 60 }, 'glm-5.2': { monthlyUsd: 180 } } },
      },
    }),
  );

  return { planDb, planBudgetsPath, planLimitsPath };
}

test('plan limits resolve per model, aggregates are rolling and the billingDay window is honoured', async () => {
  const { planDb, planBudgetsPath, planLimitsPath } = setupPlanFixture('ok');
  await withServer({ dbPath: planDb, budgetsPath: planBudgetsPath, limitsPath: planLimitsPath }, async (url) => {
    const budgets = (await (await fetch(`${url}/api/budgets`)).json()) as BudgetsBody;
    assert.equal(budgets.snapshot.status, 'ok');
    assert.equal(budgets.snapshot.source, 'https://opencode.ai/docs/go/');
    assert.equal(budgets.snapshot.capturedAt, '2026-10-08');

    // No `?month=`: the current billing cycle anchored on billingDay 15.
    assert.equal(budgets.month.isCurrent, true);
    assert.ok(budgets.month.from <= Date.now() && Date.now() < budgets.month.to);
    assert.equal(monthKeyOf(budgets.month.from), budgets.month.key, 'the key is the month the cycle starts in');
    assert.equal(new Date(budgets.month.from).getDate(), 15);

    const byKey = new Map(budgets.models.map((model) => [model.modelKey, model]));

    // Manual entry wins; `plan` still reports the snapshot limit (pinned semantics).
    const mimo = byKey.get('opencode-go/mimo-v2.6-pro');
    assert.equal(mimo?.budget?.limit, 20);
    assert.equal(mimo?.budget?.source, 'model');
    assert.deepEqual(mimo?.plan, { id: 'go', monthlyUsd: 15 });
    assert.equal(mimo?.cost5h, 1);
    assert.equal(mimo?.cost7d, 3, 'the now-10d session falls outside the 7-day window');

    const glm = byKey.get('opencode-go/glm-5.2');
    assert.equal(glm?.budget?.limit, 30);
    assert.deepEqual(glm?.plan, { id: 'go', monthlyUsd: 60 });
    assert.equal(glm?.cost5h, 0.25);
    assert.equal(glm?.cost7d, 1);

    // Under a plan, absent from the snapshot, no manual entry: never an assumed limit.
    const open = byKey.get('opencode-go/minimax-m2.5');
    assert.ok((open?.sessions ?? 0) >= 1, 'the row exists via its in-window session');
    assert.equal(open?.budget, null);
    assert.equal(open?.plan, null);

    // The default is in force for other providers (so `budget: null` above is not "no default").
    assert.deepEqual(byKey.get('opencode/free-tier')?.budget, {
      unit: 'usd',
      limit: 7,
      used: 0.5,
      ratio: 0.5 / 7,
      source: 'default',
    });

    // An explicit `?month=` names the cycle's start month, re-anchored on billingDay.
    const explicit = (await (await fetch(`${url}/api/budgets?month=2026-09`)).json()) as BudgetsBody;
    assert.equal(explicit.month.key, '2026-09');
    assert.equal(explicit.month.from, new Date(2026, 8, 15).getTime());
    assert.equal(explicit.month.to, new Date(2026, 9, 15).getTime());

    const invalid = await fetch(`${url}/api/budgets?month=nope`);
    assert.equal(invalid.status, 400);
    assert.equal(((await invalid.json()) as { error: { details?: { field: string } } }).error.details?.field, 'month');
  });
});

test('a missing or invalid limits snapshot degrades opencode-go plan rows to "No budget set"', async () => {
  const { planDb, planBudgetsPath } = setupPlanFixture('degrade');
  const run = (limitsPath: string) =>
    withServer({ dbPath: planDb, budgetsPath: planBudgetsPath, limitsPath }, async (url) => {
      return (await (await fetch(`${url}/api/budgets`)).json()) as BudgetsBody;
    });

  const assertDegraded = (budgets: BudgetsBody) => {
    const byKey = new Map(budgets.models.map((model) => [model.modelKey, model]));
    const open = byKey.get('opencode-go/minimax-m2.5');
    assert.ok((open?.sessions ?? 0) >= 1, 'the row exists via its in-window session');
    assert.equal(open?.budget, null, 'terminal: the default never applies under a plan');
    assert.equal(open?.plan, null);
    assert.equal(byKey.get('opencode-go/mimo-v2.6-pro')?.budget?.limit, 20, 'manual entries survive a broken snapshot');
    assert.deepEqual(
      byKey.get('opencode/free-tier')?.budget,
      { unit: 'usd', limit: 7, used: 0.5, ratio: 0.5 / 7, source: 'default' },
      'the default is still in force for other providers',
    );
  };

  const missing = await run(path.join(workDir, 'no-limits.json'));
  assert.equal(missing.snapshot.status, 'missing');
  assert.equal(missing.snapshot.capturedAt, null);
  assertDegraded(missing);

  const brokenPath = path.join(workDir, 'broken-limits.json');
  writeFileSync(brokenPath, '{ not json');
  const broken = await run(brokenPath);
  assert.equal(broken.snapshot.status, 'invalid');
  assert.match(broken.snapshot.message ?? '', /Not valid JSON/);
  assertDegraded(broken);
});
