import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_LIMITS_PATH } from './config.ts';
import { loadLimitSnapshot, parseLimitSnapshot } from './budgets.ts';

/**
 * Integrity checks for the bundled `subscription-limits.json` snapshot: the
 * per-model plan limits must stay a verbatim transcription of the tables in
 * the OpenCode Go docs (31 ids per plan, no subscription prices).
 */

/** Ids returned by `https://opencode.ai/zen/go/v1/models` on 2026-10-08, frozen as the known-id list. */
const ENDPOINT_MODEL_IDS = new Set([
  'minimax-m3', 'minimax-m2.7', 'minimax-m2.5', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6',
  'longcat-2.0', 'kimi-k2.5', 'glm-5.2', 'glm-5.3-flash', 'glm-5.3', 'glm-5.1', 'glm-5',
  'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-flash', 'deepseek-v4.1-flash',
  'deepseek-v4-flash-vision-exp', 'qwen3.7-max', 'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus',
  'qwen3.6-plus', 'qwen3.5-plus', 'mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2.6-pro', 'mimo-v2.6-flash',
  'longcat-2.5-preview-free', 'mimo-v2.5-pro', 'mimo-v2.5', 'hy4-preview', 'hy3', 'hy3-preview',
  'gpt-5.6-luna', 'grok-4.5', 'grok-4.7', 'grok-4.6', 'muse-spark-1.3-contributor',
  'muse-spark-1.2-contributor', 'omen-alpha', 'gpt-6-luna', 'space-bunny',
]);

/** In the docs tables but not in the models endpoint: known discrepancy, warn instead of failing. */
const DOCS_ONLY_ID = 'claude-haiku-5-5';

const KEBAB_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function readBundled(): Record<string, unknown> {
  return JSON.parse(readFileSync(DEFAULT_LIMITS_PATH, 'utf8')) as Record<string, unknown>;
}

test('the bundled snapshot lives next to package.json and loads cleanly', () => {
  assert.ok(DEFAULT_LIMITS_PATH.endsWith('subscription-limits.json'));
  const loaded = loadLimitSnapshot();
  assert.equal(loaded.status, 'ok');
  assert.equal(loaded.message, null);
});

test('the snapshot carries its source, capture date and per-plan labels', () => {
  const raw = readBundled();
  assert.equal(raw.source, 'https://opencode.ai/docs/go/');
  assert.equal(raw.capturedAt, '2026-10-08');
  const plans = raw.plans as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(plans).sort(), ['go', 'go-plus']);
  assert.equal(plans['go']?.label, 'OpenCode Go');
  assert.equal(plans['go-plus']?.label, 'OpenCode Go Plus');
  // Per-model limits only: no plan-level subscription price anywhere in the schema.
  assert.deepEqual(Object.keys(plans['go'] ?? {}).sort(), ['label', 'models']);
  assert.deepEqual(Object.keys(plans['go-plus'] ?? {}).sort(), ['label', 'models']);
});

test('both plans list the same 31 kebab-case ids with positive limits or Unlimited', () => {
  const parsed = parseLimitSnapshot(readFileSync(DEFAULT_LIMITS_PATH, 'utf8'));
  assert.ok(parsed.ok);
  const go = Object.entries(parsed.snapshot.plans.go.models);
  const goPlus = Object.entries(parsed.snapshot.plans['go-plus'].models);
  assert.equal(go.length, 31);
  assert.equal(goPlus.length, 31);
  assert.deepEqual(Object.keys(parsed.snapshot.plans.go.models).sort(), Object.keys(parsed.snapshot.plans['go-plus'].models).sort());

  for (const [planId, entries] of [['go', go], ['go-plus', goPlus]] as const) {
    for (const [modelId, limit] of entries) {
      assert.match(modelId, KEBAB_ID, `plans["${planId}"] id "${modelId}" is not kebab-case`);
      if ('unlimited' in limit) {
        assert.equal(limit.unlimited, true);
      } else {
        assert.ok(Number.isFinite(limit.monthlyUsd) && limit.monthlyUsd > 0, `plans["${planId}"].models["${modelId}"]`);
      }
    }
  }
  assert.deepEqual(parsed.snapshot.plans.go.models['longcat-2.5-preview-free'], { unlimited: true });
  assert.deepEqual(parsed.snapshot.plans['go-plus'].models['longcat-2.5-preview-free'], { unlimited: true });
});

test('every snapshot id is a known endpoint id, the docs-only claude id (warn), or a failure', (t) => {
  const parsed = parseLimitSnapshot(readFileSync(DEFAULT_LIMITS_PATH, 'utf8'));
  assert.ok(parsed.ok);
  for (const modelId of Object.keys(parsed.snapshot.plans.go.models)) {
    if (ENDPOINT_MODEL_IDS.has(modelId)) continue;
    if (modelId === DOCS_ONLY_ID) {
      t.diagnostic(`warn: ${DOCS_ONLY_ID} is in the docs tables but not in /zen/go/v1/models`);
      continue;
    }
    assert.fail(`unknown snapshot id "${modelId}": neither in the frozen endpoint list nor the known docs-only id`);
  }
});
