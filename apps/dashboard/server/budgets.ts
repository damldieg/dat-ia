/**
 * Monthly budgets: a small local JSON file compared against registered usage.
 *
 * The file holds limits only (numbers keyed by `provider/model`), never
 * credentials. It is read on every request, so editing it and pressing
 * Refresh is enough. A missing or invalid file never breaks the endpoint:
 * usage is still returned and `config.status` says what happened.
 *
 * Shape (every field optional):
 *   {
 *     "plan": "go",                    subscription plan for opencode-go/* limits ("go" | "go-plus" | null)
 *     "billingDay": 15,                day of the month the billing cycle starts (1-31; else calendar months)
 *     "totalMonthlyUsd": 60,            overall limit across all models
 *     "defaultMonthlyUsd": 10,          limit for models without their own entry
 *     "models": {
 *       "opencode-go/gpt-6-luna": { "monthlyUsd": 25 },
 *       "opencode/mimo-v2.6-flash-free": { "monthlyTokens": 50000000 }
 *     }
 *   }
 *
 * Plan limits come from `subscription-limits.json`: per-model monthly USD
 * (or Unlimited) transcribed from the OpenCode Go docs — never the plan's
 * subscription price.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { BudgetLineDTO, BudgetsDTO, ModelBudgetDTO, PlanId, TokenUsage } from '../shared/types.ts';
import { DEFAULT_LIMITS_PATH } from './config.ts';
import type { ModelUsageRow, RecentCostRow } from './store.ts';

export interface ModelBudgetConfig {
  monthlyUsd?: number;
  monthlyTokens?: number;
}

export interface BudgetConfig {
  totalMonthlyUsd?: number;
  defaultMonthlyUsd?: number;
  /** Subscription plan for `opencode-go/*` limits resolved from the snapshot. */
  plan?: PlanId;
  /** Day of the month the billing cycle starts (1-31); absent/invalid ⇒ calendar months. */
  billingDay?: number;
  models: Record<string, ModelBudgetConfig>;
}

/** A model's limit in the plan snapshot: a monthly USD amount or Unlimited. */
export type PlanModelLimit = { monthlyUsd: number } | { unlimited: true };

export interface PlanLimits {
  label: string;
  models: Record<string, PlanModelLimit>;
}

/** Contents of `subscription-limits.json` (per-model limits only, never subscription prices). */
export interface LimitSnapshot {
  source: string | null;
  capturedAt: string | null;
  plans: Record<PlanId, PlanLimits>;
}

export type LimitSnapshotResult = { ok: true; snapshot: LimitSnapshot } | { ok: false; message: string };

export interface LoadedLimitSnapshot {
  /** `null` unless the snapshot parsed cleanly. */
  snapshot: LimitSnapshot | null;
  status: BudgetsDTO['snapshot']['status'];
  message: string | null;
}

export const EMPTY_BUDGET_CONFIG: BudgetConfig = { models: {} };

export type BudgetConfigResult = { ok: true; config: BudgetConfig } | { ok: false; message: string };

export interface LoadedBudgetConfig {
  config: BudgetConfig;
  status: BudgetsDTO['config']['status'];
  message: string | null;
}

export interface MonthWindow {
  /** `YYYY-MM`. */
  key: string;
  /** Inclusive start (epoch ms, local time). */
  from: number;
  /** Exclusive end (epoch ms, local time). */
  to: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `undefined` and `null` mean "not set"; anything else must be a positive finite number. */
function readLimit(value: unknown, field: string): { ok: true; value?: number } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return { ok: false, message: `${field} must be a positive number (or null to leave it unset).` };
  }
  return { ok: true, value };
}

/** `undefined` and `null` mean "not set"; anything else must be a string. */
function readText(value: unknown, field: string): { ok: true; value?: string } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== 'string') return { ok: false, message: `${field} must be a string.` };
  return { ok: true, value };
}

export function parseBudgetConfig(text: string): BudgetConfigResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return { ok: false, message: `Not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (!isRecord(parsed)) return { ok: false, message: 'The budgets file must contain a JSON object.' };

  const config: BudgetConfig = { models: {} };

  const total = readLimit(parsed.totalMonthlyUsd, 'totalMonthlyUsd');
  if (!total.ok) return total;
  if (total.value !== undefined) config.totalMonthlyUsd = total.value;

  const fallback = readLimit(parsed.defaultMonthlyUsd, 'defaultMonthlyUsd');
  if (!fallback.ok) return fallback;
  if (fallback.value !== undefined) config.defaultMonthlyUsd = fallback.value;

  if (parsed.plan !== undefined && parsed.plan !== null) {
    if (parsed.plan !== 'go' && parsed.plan !== 'go-plus') {
      return { ok: false, message: 'plan must be "go", "go-plus" or null.' };
    }
    config.plan = parsed.plan;
  }

  // An invalid billing day silently falls back to calendar months, per the brief.
  if (typeof parsed.billingDay === 'number' && Number.isInteger(parsed.billingDay) && parsed.billingDay >= 1 && parsed.billingDay <= 31) {
    config.billingDay = parsed.billingDay;
  }

  if (parsed.models !== undefined && parsed.models !== null) {
    if (!isRecord(parsed.models)) return { ok: false, message: 'models must be an object keyed by provider/model.' };
    for (const [modelKey, entry] of Object.entries(parsed.models)) {
      if (!isRecord(entry)) {
        return { ok: false, message: `models["${modelKey}"] must be an object such as { "monthlyUsd": 10 }.` };
      }
      const usd = readLimit(entry.monthlyUsd, `models["${modelKey}"].monthlyUsd`);
      if (!usd.ok) return usd;
      const tokens = readLimit(entry.monthlyTokens, `models["${modelKey}"].monthlyTokens`);
      if (!tokens.ok) return tokens;
      const model: ModelBudgetConfig = {};
      if (usd.value !== undefined) model.monthlyUsd = usd.value;
      if (tokens.value !== undefined) model.monthlyTokens = tokens.value;
      if (model.monthlyUsd !== undefined || model.monthlyTokens !== undefined) config.models[modelKey] = model;
    }
  }

  return { ok: true, config };
}

/** Reads the budgets file. Never throws: a missing or broken file yields an empty config plus a status. */
export function loadBudgetConfig(file: string): LoadedBudgetConfig {
  if (!existsSync(file)) return { config: EMPTY_BUDGET_CONFIG, status: 'missing', message: null };
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (cause) {
    return {
      config: EMPTY_BUDGET_CONFIG,
      status: 'invalid',
      message: `Cannot read the file: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  const result = parseBudgetConfig(text);
  if (!result.ok) return { config: EMPTY_BUDGET_CONFIG, status: 'invalid', message: result.message };
  return { config: result.config, status: 'ok', message: null };
}

/** Validates one snapshot plan entry: a positive monthly USD amount or Unlimited. */
function readPlanModelLimit(
  value: unknown,
  field: string,
): { ok: true; value: PlanModelLimit } | { ok: false; message: string } {
  const expected = `${field} must be { "monthlyUsd": n } or { "unlimited": true }.`;
  if (!isRecord(value)) return { ok: false, message: expected };
  if (value.unlimited === true) return { ok: true, value: { unlimited: true } };
  const usd = readLimit(value.monthlyUsd, `${field}.monthlyUsd`);
  if (!usd.ok) return usd;
  if (usd.value === undefined) return { ok: false, message: expected };
  return { ok: true, value: { monthlyUsd: usd.value } };
}

export function parseLimitSnapshot(text: string): LimitSnapshotResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return { ok: false, message: `Not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (!isRecord(parsed)) return { ok: false, message: 'The limits file must contain a JSON object.' };

  const source = readText(parsed.source, 'source');
  if (!source.ok) return source;
  const capturedAt = readText(parsed.capturedAt, 'capturedAt');
  if (!capturedAt.ok) return capturedAt;

  if (!isRecord(parsed.plans)) return { ok: false, message: 'plans must be an object with "go" and "go-plus".' };
  const plans = {} as Record<PlanId, PlanLimits>;
  for (const id of ['go', 'go-plus'] as const) {
    const entry = parsed.plans[id];
    if (!isRecord(entry)) return { ok: false, message: `plans["${id}"] must be an object with a label and per-model limits.` };
    if (typeof entry.label !== 'string' || entry.label === '') {
      return { ok: false, message: `plans["${id}"].label must be a non-empty string.` };
    }
    if (!isRecord(entry.models)) return { ok: false, message: `plans["${id}"].models must be an object keyed by model id.` };
    const models: Record<string, PlanModelLimit> = {};
    for (const [modelId, raw] of Object.entries(entry.models)) {
      const limit = readPlanModelLimit(raw, `plans["${id}"].models["${modelId}"]`);
      if (!limit.ok) return limit;
      models[modelId] = limit.value;
    }
    plans[id] = { label: entry.label, models };
  }

  return { ok: true, snapshot: { source: source.value ?? null, capturedAt: capturedAt.value ?? null, plans } };
}

/** Reads the plan-limits snapshot. Never throws: a missing or broken file yields a null snapshot plus a status. */
export function loadLimitSnapshot(file: string = DEFAULT_LIMITS_PATH): LoadedLimitSnapshot {
  if (!existsSync(file)) return { snapshot: null, status: 'missing', message: null };
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (cause) {
    return {
      snapshot: null,
      status: 'invalid',
      message: `Cannot read the file: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  const result = parseLimitSnapshot(text);
  if (!result.ok) return { snapshot: null, status: 'invalid', message: result.message };
  return { snapshot: result.snapshot, status: 'ok', message: null };
}

/** Calendar month in the local time zone of this process. `month` is 1-12. */
export function monthWindow(year: number, month: number): MonthWindow {
  return {
    key: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
    from: new Date(year, month - 1, 1).getTime(),
    to: new Date(year, month, 1).getTime(),
  };
}

export function currentMonthWindow(now: number = Date.now()): MonthWindow {
  const date = new Date(now);
  return monthWindow(date.getFullYear(), date.getMonth() + 1);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Local midnight of day `min(billingDay, days-in-month)` of `month` (1-12). */
function cycleStart(year: number, month: number, billingDay: number): number {
  return new Date(year, month - 1, Math.min(billingDay, daysInMonth(year, month))).getTime();
}

/**
 * Billing cycle labelled `YYYY-MM`. With `billingDay` D the cycle runs from
 * local midnight of day `min(D, days-in-month)` of month M to the same rule
 * for M+1, end-exclusive (so D=31 clamps in short months); without it the
 * cycle is the calendar month.
 */
export function billingWindow(year: number, month: number, billingDay?: number): MonthWindow {
  const cycle = monthWindow(year, month);
  if (billingDay === undefined) return cycle;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    key: cycle.key,
    from: cycleStart(year, month, billingDay),
    to: cycleStart(nextYear, nextMonth, billingDay),
  };
}

/**
 * The billing cycle whose `[from, to)` contains `now` — it may start in the
 * previous month, and `key` is the month of its start.
 */
export function currentBillingWindow(now: number = Date.now(), billingDay?: number): MonthWindow {
  const date = new Date(now);
  let year = date.getFullYear();
  let month = date.getMonth() + 1;
  let window = billingWindow(year, month, billingDay);
  if (now < window.from) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    window = billingWindow(year, month, billingDay);
  } else if (now >= window.to) {
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
    window = billingWindow(year, month, billingDay);
  }
  return window;
}

function tokensOf(row: ModelUsageRow): TokenUsage {
  return {
    input: row.tokens_input,
    output: row.tokens_output,
    reasoning: row.tokens_reasoning,
    cacheRead: row.tokens_cache_read,
    cacheWrite: row.tokens_cache_write,
  };
}

/** Code-unit order: deterministic on every machine, unlike locale collation. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const NO_TOKENS: TokenUsage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };

function line(unit: BudgetLineDTO['unit'], limit: number, used: number, source: BudgetLineDTO['source']): BudgetLineDTO {
  return { unit, limit, used, ratio: used / limit, source };
}

/** Per-model limit under the configured plan, pinned to the snapshot entry (`null` = Unlimited). */
export interface ModelPlanInfo {
  id: PlanId;
  monthlyUsd: number | null;
}

export type ResolvedLimit =
  | { kind: 'line'; line: BudgetLineDTO; plan: ModelPlanInfo | null }
  | { kind: 'unlimited'; plan: ModelPlanInfo | null }
  | { kind: 'none'; plan: ModelPlanInfo | null };

const PLAN_KEY_PREFIX = 'opencode-go/';

/** The model's snapshot entry under the configured plan, or `null` when no plan limit applies. */
function planInfoFor(modelKey: string, config: BudgetConfig, snapshot: LimitSnapshot | null): ModelPlanInfo | null {
  if (config.plan === undefined || snapshot === null) return null;
  if (!modelKey.startsWith(PLAN_KEY_PREFIX)) return null;
  const entry = snapshot.plans[config.plan].models[modelKey.slice(PLAN_KEY_PREFIX.length)];
  if (entry === undefined) return null;
  return 'unlimited' in entry ? { id: config.plan, monthlyUsd: null } : { id: config.plan, monthlyUsd: entry.monthlyUsd };
}

/**
 * Budget resolution for one model, in order: the model's own entry (USD wins
 * over tokens), then the configured plan's per-model snapshot limit for
 * `opencode-go/<id>` models, then the default. An `opencode-go/*` model under
 * a plan whose snapshot entry is Unlimited — or absent, including when the
 * snapshot itself is missing or invalid — is terminal: no limit is ever
 * assumed, and the default never applies. Token limits compare input + output
 * tokens, the same figure the task table shows. `plan` reports the snapshot
 * limit alongside any resolved line; `plan.monthlyUsd` equals `line.limit`
 * only when the line is plan-sourced.
 */
function resolveLimit(
  modelKey: string,
  cost: number,
  tokens: TokenUsage,
  config: BudgetConfig,
  snapshot: LimitSnapshot | null,
): ResolvedLimit {
  const plan = planInfoFor(modelKey, config, snapshot);
  const own = config.models[modelKey];
  if (own?.monthlyUsd !== undefined) return { kind: 'line', line: line('usd', own.monthlyUsd, cost, 'model'), plan };
  if (own?.monthlyTokens !== undefined) {
    return { kind: 'line', line: line('tokens', own.monthlyTokens, tokens.input + tokens.output, 'model'), plan };
  }
  if (plan !== null) {
    return plan.monthlyUsd === null
      ? { kind: 'unlimited', plan }
      : { kind: 'line', line: line('usd', plan.monthlyUsd, cost, plan.id), plan };
  }
  if (config.plan !== undefined && modelKey.startsWith(PLAN_KEY_PREFIX)) return { kind: 'none', plan: null };
  if (config.defaultMonthlyUsd !== undefined) {
    return { kind: 'line', line: line('usd', config.defaultMonthlyUsd, cost, 'default'), plan: null };
  }
  return { kind: 'none', plan: null };
}

export function toBudgetsDTO(input: {
  window: MonthWindow;
  usage: ModelUsageRow[];
  recent5h: RecentCostRow[];
  recent7d: RecentCostRow[];
  sessionsWithoutModel: number;
  loaded: LoadedBudgetConfig;
  snapshot: LoadedLimitSnapshot;
  configPath: string;
  now?: number;
}): BudgetsDTO {
  const { window, usage, loaded, snapshot } = input;
  const now = input.now ?? Date.now();
  const config = loaded.config;
  const cost5hByModel = new Map(input.recent5h.map((row) => [row.model_key, row.cost]));
  const cost7dByModel = new Map(input.recent7d.map((row) => [row.model_key, row.cost]));

  const rowDTO = (modelKey: string, row: Pick<ModelUsageRow, 'sessions' | 'cost'> & { tokens: TokenUsage }): ModelBudgetDTO => {
    const resolved = resolveLimit(modelKey, row.cost, row.tokens, config, snapshot.snapshot);
    return {
      modelKey,
      sessions: row.sessions,
      cost: row.cost,
      tokens: row.tokens,
      budget: resolved.kind === 'line' ? resolved.line : null,
      plan: resolved.plan,
      cost5h: cost5hByModel.get(modelKey) ?? 0,
      cost7d: cost7dByModel.get(modelKey) ?? 0,
    };
  };

  const models: ModelBudgetDTO[] = usage.map((row) => rowDTO(row.model_key, { sessions: row.sessions, cost: row.cost, tokens: tokensOf(row) }));

  // Models with a budget of their own but no usage yet still get a row (an empty bar).
  const seen = new Set(models.map((model) => model.modelKey));
  for (const modelKey of Object.keys(config.models)) {
    if (seen.has(modelKey)) continue;
    models.push(rowDTO(modelKey, { sessions: 0, cost: 0, tokens: NO_TOKENS }));
  }

  // Budgeted models first (closest to the limit on top), then the rest by spend.
  models.sort((a, b) => {
    if (a.budget && b.budget) return b.budget.ratio - a.budget.ratio || compareText(a.modelKey, b.modelKey);
    if (a.budget) return -1;
    if (b.budget) return 1;
    return (
      b.cost - a.cost ||
      b.tokens.input + b.tokens.output - (a.tokens.input + a.tokens.output) ||
      compareText(a.modelKey, b.modelKey)
    );
  });

  const total = usage.reduce(
    (acc, row) => ({
      sessions: acc.sessions + row.sessions,
      cost: acc.cost + row.cost,
      tokens: {
        input: acc.tokens.input + row.tokens_input,
        output: acc.tokens.output + row.tokens_output,
        reasoning: acc.tokens.reasoning + row.tokens_reasoning,
        cacheRead: acc.tokens.cacheRead + row.tokens_cache_read,
        cacheWrite: acc.tokens.cacheWrite + row.tokens_cache_write,
      },
    }),
    { sessions: 0, cost: 0, tokens: NO_TOKENS },
  );

  const isCurrent = now >= window.from && now < window.to;
  const elapsedRatio = now >= window.to ? 1 : now <= window.from ? 0 : (now - window.from) / (window.to - window.from);

  return {
    generatedAt: now,
    month: { key: window.key, from: window.from, to: window.to, isCurrent, elapsedRatio },
    total: {
      ...total,
      budget: config.totalMonthlyUsd !== undefined ? line('usd', config.totalMonthlyUsd, total.cost, 'total') : null,
    },
    models,
    sessionsWithoutModel: input.sessionsWithoutModel,
    config: { path: input.configPath, status: loaded.status, message: loaded.message },
    snapshot: {
      source: snapshot.snapshot?.source ?? null,
      capturedAt: snapshot.snapshot?.capturedAt ?? null,
      status: snapshot.status,
      message: snapshot.message,
    },
  };
}
