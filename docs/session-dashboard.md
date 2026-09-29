# Session dashboard — local OpenCode observability

This dashboard answers "what sessions ran, on which agent/model, when, and at what registered
cost?" without ever letting the browser touch SQLite. A small Node adapter reads
`~/.local/share/opencode/opencode.db` **read-only** and serves an allowlisted JSON DTO; a
Vite + React + TypeScript SPA renders summary, filters, a session table and a parent/child detail
tree. Everything binds to `127.0.0.1`; nothing leaves this machine.

## Quick path

```bash
cd apps/dashboard
npm install          # first run only — installs locally into apps/dashboard/node_modules
npm run dev          # SPA on http://127.0.0.1:5173, API mounted under /api
```

3. Open <http://127.0.0.1:5173> and confirm the summary cards and session table populate.
4. Verify the API directly:

```bash
curl -s http://127.0.0.1:5173/api/health   # dev (middleware), or http://127.0.0.1:8787/api/health with npm start
curl -s 'http://127.0.0.1:5173/api/sessions?children=only' | head -c 400
```

Production-style local run (serves the built SPA and the API from one process):

```bash
npm run build && npm start                 # http://127.0.0.1:8787
```

## Details

| Topic | Decision |
|-------|----------|
| Browser ↔ data | Browser only calls `/api/*` over loopback; it never opens SQLite and never sees raw rows |
| DB access | Node `node:sqlite` `DatabaseSync(path, { readOnly: true })`, opened per request |
| DB path | `OPENCODE_DB_PATH` env var, default `~/.local/share/opencode/opencode.db` |
| Binding | `127.0.0.1` only (`PORT`, default `8787`); no CORS headers, no outbound calls |
| Queries | Static SQL with explicit column lists and `?` parameters — no `SELECT *`, no string interpolation |
| DTO | Explicit allowlist in `shared/types.ts`; rows are mapped field by field, never spread |
| Cost | Registered values only; `—` when no cost is registered (see [Cost limitations](#cost-limitations)) |
| Runtime deps | `react`, `react-dom` only — SQLite comes from the Node standard library |
| Node | `>= 24` (the server runs TypeScript natively via type stripping; verified on v24.19.0) |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browser — apps/dashboard/src (React SPA)                             │
│   summary cards · filter bar · session table · detail tree           │
│   never parses SQLite, never receives raw columns                    │
└───────────────┬──────────────────────────────────────────────────────┘
                │ fetch /api/*  (loopback only, JSON, no-store)
┌───────────────▼──────────────────────────────────────────────────────┐
│ Local API adapter — apps/dashboard/server                            │
│   dev:   Vite middleware plugin (vite.config.ts) on 127.0.0.1:5173   │
│   start: node server/index.ts (+ static dist/) on 127.0.0.1:8787     │
│   params.ts  → validates every query parameter (400 on bad input)    │
│   store.ts   → static, parameterized SQL (session_v2 + project)      │
│   dto.ts     → allowlisted SessionDTO / SummaryDTO mapping           │
└───────────────┬──────────────────────────────────────────────────────┘
                │ node:sqlite, readOnly: true, one handle per request
┌───────────────▼──────────────────────────────────────────────────────┐
│ ~/.local/share/opencode/opencode.db   (written by OpenCode)          │
└──────────────────────────────────────────────────────────────────────┘
```

Code map:

| Path | Role |
|------|------|
| `apps/dashboard/shared/types.ts` | The privacy-safe read model — the only shapes allowed on the wire |
| `apps/dashboard/server/app.ts` | Route dispatch, JSON errors, HEAD/GET only |
| `apps/dashboard/server/store.ts` | Static SQL, filter composition with bound parameters |
| `apps/dashboard/server/dto.ts` | Row → DTO allowlist mapping, cost status rule |
| `apps/dashboard/server/params.ts` | Query validation (enums, ranges, session-id format) |
| `apps/dashboard/server/db.ts` | Read-only open, friendly 503s for missing/busy database |
| `apps/dashboard/server/index.ts` | Standalone server + SPA static serving |
| `apps/dashboard/src/` | SPA: `components/`, `lib/` (api, filters, tree, format, useAsync) |

## Safe schema and read model

**Tables read:** `session_v2` (with a `LEFT JOIN project` for labels). That is the complete list.

| Read (explicit column list) | Never read or returned |
|-----------------------------|------------------------|
| `id`, `parent_id`, `project_id`, `directory`, `title` | `share_url`, `metadata`, `permission`, `revert` |
| `agent`, `model` (parsed to `{id, providerId, variant}`) | `summary_diffs`, `summary_files`, `path`, `slug` |
| `time_created`, `time_updated` | `fork_session_id`, `fork_boundary`, `version` |
| `cost`, `tokens_input/output/reasoning/cache_read/cache_write` | `session_message`, `event`, `account`, `credential`, `permission`, `instruction_*`, `kv` tables |
| derived: `child_count`, `model_key`, project label (name or worktree basename) | every message body, prompt, tool call and share link |

Rules enforced in code and covered by tests:

1. **No `SELECT *`.** Columns are enumerated in `store.ts`; a column cannot leak if it is not
   selected.
2. **No row spreading.** `dto.ts` copies field by field into `SessionDTO`; `dto.test.ts` asserts
   the exact key set.
3. **No interpolated input.** Filters are fixed SQL fragments plus `?` placeholders
   (`params.test.ts` feeds `' OR 1=1 --` style values and asserts they stay inert).
4. **Leak regression test.** `server/app.test.ts` creates a fixture database whose forbidden
   columns contain `LEAK_*` markers and fails if any response body contains a marker or a
   forbidden JSON key.

### Cost status rule

`session_v2.cost` is `REAL NOT NULL DEFAULT 0`, so the schema has no "registered" flag:

| Condition | DTO | Shown as |
|-----------|-----|----------|
| Model registered (`model` parses to id + providerID) and `cost = 0` | `{status:'known', value:0}` | `$0.00` |
| Model registered and `cost > 0` | `{status:'known', value}` | `$1.43` |
| No registered model (including malformed/absent `model`) | `{status:'unavailable'}` | `—` |

## Startup

| Script (repo root or `apps/dashboard/`) | What it does |
|-----------------------------------------|--------------|
| `npm run dev` | Vite dev server + API middleware (one process, port 5173) |
| `npm run build` | `tsc --noEmit` then `vite build` → `dist/` |
| `npm start` | Standalone loopback server: API + built SPA on port 8787 |
| `npm run api` | Same binary as `npm start` (alias, useful on a second terminal) |
| `npm run lint` | ESLint flat config over TS/TSX sources |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Frontend tests (vitest) + adapter tests (`node --test`) |

Environment (filesystem path and port only — never tokens or credentials):

| Variable | Default | Meaning |
|----------|---------|---------|
| `OPENCODE_DB_PATH` | `~/.local/share/opencode/opencode.db` | Database opened read-only |
| `PORT` | `8787` | Standalone server port (loopback only) |

On startup the process prints a local-only warning, the resolved database path and whether the
file exists. The API binds `127.0.0.1`; there is no code path that listens on other interfaces.

## Routing validation

### Dashboard API routes

| Route | Method | Success | Failure modes (JSON `{error:{code,message,details}}`) |
|-------|--------|---------|--------------------------------------------------------|
| `/api/health` | GET/HEAD | `200` `{ok, localOnly, readOnly, dbPath, dbExists}` | `503 db-not-found` |
| `/api/summary` | GET/HEAD | `200` aggregate summary | `503 db-*`, `500 internal-error` |
| `/api/sessions` | GET/HEAD | `200` `{sessions,total}` | `400 invalid-parameter` (names the field + allowed values), `405` for non-GET |
| `/api/sessions/:id` | GET/HEAD | `200` `{session,descendants}` | `400 invalid-session-id`, `404 session-not-found` |
| anything else | any | — | `404 route-not-found` |

Manual checks:

```bash
curl -i -X POST http://127.0.0.1:8787/api/sessions   # 405, Allow: GET
curl -s 'http://127.0.0.1:8787/api/sessions?children=bogus'   # 400, details.allowed = [include, only, exclude]
curl -s 'http://127.0.0.1:8787/api/sessions?from=5000&to=1000' # 400, details.field = from
curl -s http://127.0.0.1:8787/api/sessions/ses_nope            # 404 session-not-found
```

### OpenCode model routing evidence (read-only, 2026-09-30)

- `bash scripts/validate-free-profile.sh` → **RESULT: OK** — 14 profile agents resolve to
  `opencode/mimo-v2.6-flash-free` or `opencode-go/space-bunny-free`; 2 model references, both
  allowlisted and in the `opencode models` catalog.
- `opencode debug agents` (run from the repository root) returned **28 agents** in this session.
  Earlier exploration recorded it as an empty list in the parent shell context; that failure did
  not reproduce here, so the validator now passes. If you see an empty list again, run the
  command from the repository root inside a fresh shell — see [Troubleshooting](#troubleshooting).
- Parent/child routing: 22 sessions in the local database, 12 roots and 10 children, **0
  orphans** — `parent_id` is populated for every child, so the detail tree has a complete chain.
  The child sessions of this task ran on `opencode/mimo-v2.6-flash-free` (matching the profile),
  while the parent runtime model reported by the orchestrator session is `gpt-5.6-luna`
  (reported evidence, global paid configuration).

## Privacy

- **Local only.** The server listens on `127.0.0.1`; no CORS headers are emitted and the SPA
  makes no cross-origin request. No telemetry, no analytics, no external calls.
- **Read only.** Every request opens the database with `readOnly: true`; a write attempt fails in
  SQLite (`attempt to write a readonly database`), verified in this task.
- **Allowlisted data.** Only the fields in `shared/types.ts` cross the wire. Prompts, messages,
  tool events, account/credential rows, permissions, share URLs and raw metadata are neither
  queried nor returned — enforced by the leak regression test.
- **No environment secrets.** Configuration reads `OPENCODE_DB_PATH` and `PORT` only. The adapter
  never reads `~/.config/opencode/opencode.json`, auth files, tokens or shell exports.
- The page carries a permanent privacy notice, and responses are `Cache-Control: no-store`.

### Project MCP servers and this dashboard

`opencode.json` also declares two project-local MCP servers (`figma`, remote; `chrome-devtools`,
local) — see the README section *Project-local MCP servers* for configuration, scope and
verification commands. For this dashboard specifically:

| Concern | Effect on the dashboard |
|---------|-------------------------|
| Read path | Browser → `/api/*` → read-only SQLite involves **no MCP server**; no session, cost or prompt data can reach Figma through this app |
| Browser automation | The `chrome-devtools` server may drive a browser against `http://127.0.0.1:5173` / `127.0.0.1:8787`; it runs on this machine, so dashboard testing stays local |
| Remote endpoint | `figma` sends data to Figma's servers **only** when you explicitly use its tools; the dashboard never calls it. Observed 2026-09-30: `opencode mcp list` → `figma needs authentication` (not authenticated) |
| Secrets | The repository stores no OAuth state or tokens; `opencode.json` holds a URL and a command only |

## Cost limitations

- Costs are **exactly what OpenCode stored** in `session_v2.cost`; the dashboard never estimates,
  converts or infers a price.
- `cost` is `NOT NULL DEFAULT 0`, so "zero" and "not registered" are only distinguishable when no
  model is registered. A session with a registered model, non-zero tokens and `cost = 0` is shown
  as **`$0.00` (registered zero)** — this is correct for free models and for sessions with no
  usage yet, but the schema cannot prove registration for that row. Treat `$0.00` with token
  usage as "likely free model", not as audited billing data.
- Sessions without a registered model are shown as **`—`** and are **excluded from the cost
  total**; their count appears in the summary card as "sessions without registered cost".
- Currency follows OpenCode's own convention (provider pricing, USD). The adapter does not
  exchange rates or historical re-pricing.
- Totals are per database snapshot: the summary and the table are separate queries, so a session
  written between the two can make them differ by one row until you press Refresh.

## Testing, lint and build

| Command | Coverage |
|---------|----------|
| `npm run test:server` | `node --test server/*.test.ts` — DTO allowlist + cost rule, parameter validation, and an HTTP end-to-end suite over a fixture database (filters, pagination, descendant recursion, 400/404/405/503 paths, leak markers) |
| `npm run test:client` | `vitest run` — tree building (orphans/cycles), cost/token/time formatting, range filters, and render tests for table, summary, detail tree and loading/error/empty panels |
| `npm run lint` | ESLint (flat, `typescript-eslint` recommended) |
| `npm run build` | `tsc --noEmit` + `vite build` |

Recorded results for this change: `test:server` 27/27 pass, `test:client` 38/38 pass, `lint` clean,
`build` clean (see the ODD task log for exact output).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `503 db-not-found` / footer shows `DB missing` | OpenCode has not written a database yet, or `OPENCODE_DB_PATH` points elsewhere | Start OpenCode once, or set `OPENCODE_DB_PATH` to the real file (`opencode paths` lists data paths) |
| `503 db-open-failed` / `attempt to write a readonly database` | The path is not a database file, or permissions prevent reading | Verify the file with `sqlite3 "$OPENCODE_DB_PATH" 'select count(*) from session_v2;'` |
| `503 db-unavailable` with a "locked" message | OpenCode was mid-write during the query | Retry (Refresh button); reads are normally non-blocking because OpenCode uses WAL |
| Empty table, `No sessions recorded yet` | The selected database really has no sessions, or you are pointed at a fresh profile | Check `curl -s http://127.0.0.1:8787/api/health`, then the database path |
| Summary loads, list says `Could not load data` with a 400 | A filter produced an invalid parameter (for example an over-long value) | Press *Clear filters*; the error names the offending field |
| `port 8787 is already in use` | Another process holds the port | `PORT=8788 npm start` |
| `Session dashboard build not found` on `npm start` | `dist/` missing | `npm run build` first |
| Vite dev server runs but `/api/*` 404s | The API middleware plugin failed to load, or you opened the wrong origin | Use the printed `http://127.0.0.1:5173` URL; check the terminal for a `node:sqlite` error |
| `opencode debug agents` prints `[]` | Observed earlier from the parent shell context (see ODD log) | Run it from the repository root in a fresh shell; the validator fails closed either way |
| `opencode mcp list` shows `figma needs authentication` | Expected until the interactive OAuth flow is completed; the dashboard does not depend on it | Ignore it for dashboard work, or run `opencode mcp auth figma` when you actually need Figma |
| `chrome-devtools` MCP does not connect | First `npx -y chrome-devtools-mcp@latest` run needs package resolution, a supported Node (`^20.19 \|\| ^22.12 \|\| >=23`), and a locally installed Chrome | Run the checks from the README troubleshooting table; the dashboard itself works without it |
| Stale data after resuming OpenCode | Summary/table are snapshots per request | Press **Refresh** |

## Checklist

- [ ] `curl /api/health` reports `localOnly: true`, `readOnly: true` and an existing database
- [ ] The browser network tab shows only same-origin `/api/*` requests
- [ ] A session with no registered model shows `—`, and the cost total does not include it
- [ ] `npm test`, `npm run lint` and `npm run build` all exit 0
- [ ] MCP status never blocks dashboard checks: `opencode mcp list` shows `chrome-devtools connected`, and `figma needs authentication` is treated as "not authorized yet", not as a dashboard failure
- [ ] `git status` shows no files outside `dat-ia` changed
