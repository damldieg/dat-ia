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
 *     "totalMonthlyUsd": 60,            overall limit across all models
 *     "defaultMonthlyUsd": 10,          limit for models without their own entry
 *     "models": {
 *       "opencode-go/gpt-6-luna": { "monthlyUsd": 25 },
 *       "opencode/mimo-v2.6-flash-free": { "monthlyTokens": 50000000 }
 *     }
 *   }
 */
import { existsSync, readFileSync } from 'node:fs';
import type { BudgetLineDTO, BudgetsDTO, ModelBudgetDTO, TokenUsage } from '../shared/types.ts';
import type { ModelUsageRow } from './store.ts';

export interface ModelBudgetConfig {
  monthlyUsd?: number;
  monthlyTokens?: number;
}

export interface BudgetConfig {
  totalMonthlyUsd?: number;
  defaultMonthlyUsd?: number;
  models: Record<string, ModelBudgetConfig>;
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

/**
 * Budget line for one model. A model's own entry wins over the default; within
 * an entry a USD limit wins over a token limit. Token limits compare input +
 * output tokens, the same figure the task table shows.
 */
function budgetFor(modelKey: string, cost: number, tokens: TokenUsage, config: BudgetConfig): BudgetLineDTO | null {
  const own = config.models[modelKey];
  if (own?.monthlyUsd !== undefined) return line('usd', own.monthlyUsd, cost, 'model');
  if (own?.monthlyTokens !== undefined) return line('tokens', own.monthlyTokens, tokens.input + tokens.output, 'model');
  if (config.defaultMonthlyUsd !== undefined) return line('usd', config.defaultMonthlyUsd, cost, 'default');
  return null;
}

export function toBudgetsDTO(input: {
  window: MonthWindow;
  usage: ModelUsageRow[];
  sessionsWithoutModel: number;
  loaded: LoadedBudgetConfig;
  configPath: string;
  now?: number;
}): BudgetsDTO {
  const { window, usage, loaded } = input;
  const now = input.now ?? Date.now();
  const config = loaded.config;

  const models: ModelBudgetDTO[] = usage.map((row) => {
    const tokens = tokensOf(row);
    return {
      modelKey: row.model_key,
      sessions: row.sessions,
      cost: row.cost,
      tokens,
      budget: budgetFor(row.model_key, row.cost, tokens, config),
    };
  });

  // Models with a budget of their own but no usage yet still get a row (an empty bar).
  const seen = new Set(models.map((model) => model.modelKey));
  for (const modelKey of Object.keys(config.models)) {
    if (seen.has(modelKey)) continue;
    models.push({ modelKey, sessions: 0, cost: 0, tokens: NO_TOKENS, budget: budgetFor(modelKey, 0, NO_TOKENS, config) });
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
  };
}
