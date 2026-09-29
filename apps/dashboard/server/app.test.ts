import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApiHandler } from './app.ts';

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
  server = createServer(createApiHandler({ dbPath }));
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
