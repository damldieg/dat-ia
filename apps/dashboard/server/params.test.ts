import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIMIT, isValidSessionId, parseSessionParams } from './params.ts';

function parse(query: string) {
  return parseSessionParams(new URLSearchParams(query));
}

/** Returns the validation detail of a rejected parse (fails the test otherwise). */
function detailOf(query: string) {
  const result = parse(query);
  if (result.ok) throw new Error(`expected the query "${query}" to be rejected`);
  return result.detail;
}

test('defaults are applied when no parameters are sent', () => {
  const result = parse('');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.children, 'include');
  assert.equal(result.value.limit, DEFAULT_LIMIT);
  assert.equal(result.value.offset, 0);
  assert.equal(result.value.from, undefined);
  assert.equal(result.value.agent, undefined);
});

test('valid filters are parsed into the resolved filter', () => {
  const result = parse(
    'from=1000&to=2000&agent=general&model=opencode%2Fmimo-v2.6-flash-free&project=p1&children=only&limit=10&offset=20',
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    children: 'only',
    limit: 10,
    offset: 20,
    from: 1000,
    to: 2000,
    agent: 'general',
    model: 'opencode/mimo-v2.6-flash-free',
    project: 'p1',
  });
});

test('invalid enum values are rejected with the allowed list', () => {
  const detail = detailOf('children=maybe');
  assert.equal(detail.field, 'children');
  assert.deepEqual(detail.allowed, ['include', 'only', 'exclude']);
});

test('out-of-range and non-numeric numbers are rejected', () => {
  for (const query of ['limit=0', 'limit=501', 'limit=abc', 'offset=-1', 'from=yesterday', 'to=99999999999999999999']) {
    const detail = detailOf(query);
    assert.ok(detail.field.length > 0, `expected a field name for ${query}`);
    assert.ok(detail.message.length > 0);
  }
});

test('an inverted time range is rejected', () => {
  assert.equal(detailOf('from=5000&to=1000').field, 'from');
});

test('SQL-looking values stay inert parameters, not clauses', () => {
  const result = parse("agent=' OR 1=1 --&model=x' UNION SELECT secret FROM credential --");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.agent, "' OR 1=1 --");
  assert.equal(result.value.model, "x' UNION SELECT secret FROM credential --");
});

test('over-long selector values are rejected instead of silently ignored', () => {
  assert.equal(detailOf(`agent=${'a'.repeat(201)}`).field, 'agent');
});

test('unknown parameters are ignored for forward compatibility', () => {
  const result = parse('sort=desc&unknown=1');
  assert.equal(result.ok, true);
});

test('session id validation accepts OpenCode ids and rejects path tricks', () => {
  assert.equal(isValidSessionId('ses_f11b3cbd8ffeMhQBrc7Ahn0xZp'), true);
  assert.equal(isValidSessionId('a-b_c1'), true);
  assert.equal(isValidSessionId('ab'), false);
  assert.equal(isValidSessionId('../../etc/passwd'), false);
  assert.equal(isValidSessionId('id with space'), false);
  assert.equal(isValidSessionId('x'.repeat(129)), false);
});
