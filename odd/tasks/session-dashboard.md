# ODD Task: local OpenCode session dashboard

**Feature**: session-dashboard
**Repository**: /Users/damiandiego/Desktop/Development/dat-ia
**Route**: Delegated direct — one bounded writer for the API adapter, SPA, tests, and documentation.
**Delivery**: Local commits only until the exact GitHub URL and explicit remote authorization are provided.

## Objective

Create a local-only observability dashboard for OpenCode sessions, using a safe API adapter over the local SQLite database and a Vite/React/TypeScript SPA.

## Authorized scope

- `/Users/damiandiego/Desktop/Development/dat-ia/**`
- Read-only inspection of `~/.local/share/opencode/opencode.db`
- No remote operations, credentials, tokens, SSH/session changes, or external data transmission.

## Tasks

- [x] T1 — Validate OpenCode routing and record parent/child evidence.
- [x] T2 — Inspect the SQLite schema and define a privacy-safe read model.
- [x] T3 — Implement the local API adapter.
- [x] T4 — Implement the dashboard SPA with filters and session detail tree.
- [x] T5 — Add tests, scripts, documentation, and privacy/troubleshooting guidance.
- [x] T6 — Run validation and create reviewable local commits (one local work-unit commit for this unit; no remote operations).
- [ ] T7 — Configure/publish GitHub only after exact URL and explicit authorization.
- [x] T8 — Document the project-local MCP servers (`figma` remote OAuth, `chrome-devtools` local) with verification and troubleshooting, and record honest evidence.

## Acceptance criteria

- The browser never opens SQLite directly and no prompt/credential fields are exposed.
- The dashboard reports sessions, parent/child relationships, agents, models/variants, timing, tokens, and registered costs, including unknown-cost states.
- Loading, error, empty, filters, summary, table, and detail-tree states work locally.
- JSON/config validation, routing probe, tests, lint, build, `git diff --check`, status, secret scan, and remote inspection are recorded honestly.
- Project-local MCP servers are documented with honest status: no secrets in the repository, Figma OAuth described as interactive and unauthenticated here, Chrome requirements stated, verification and troubleshooting commands included.

## Progress

- Created before source implementation, as required by ODD.
- Initial checks: OpenCode v2.0.19; repository profile validator initially failed because `opencode debug agents`
  returned an empty list from the parent shell context; SQLite schema is available and contains `session_v2`
  plus project/workspace tables.
- **T1 (observed 2026-09-30)**: `bash scripts/validate-free-profile.sh` now returns `RESULT: OK — 14 agents on
  free models` (2 model references, both allowlisted and in the catalog); `opencode debug agents` from the
  repository root returned **28 agents**, so the earlier empty-list failure did **not** reproduce in this
  context (recorded, not concealed — see `docs/session-dashboard.md` troubleshooting). Parent/child evidence
  from the live database: 22 sessions, 12 roots, 10 children, **0 orphans**; children of this task ran on
  `opencode/mimo-v2.6-flash-free` while the parent runtime model is reported as `gpt-5.6-luna`.
- **T2 (observed)**: `session_v2` carries `parent_id`, `directory`, `title`, `agent`, JSON `model`,
  `time_created/time_updated`, `cost` (`REAL NOT NULL DEFAULT 0`) and token columns; `project` carries
  `name`/`worktree`. Read model: explicit allowlist of those fields only — `share_url`, `metadata`,
  `permission`, `revert`, `summary_*`, `path`, `slug`, `fork_*` are never selected, and the
  `session_message`/`event`/`account`/`credential`/`permission` tables are never queried. Cost rule: registered
  value when a model is registered, otherwise `unavailable` (shown `—`, excluded from totals).
- **T3 (observed)**: adapter in `apps/dashboard/server/` uses `node:sqlite` `DatabaseSync(path, {readOnly:true})`
  per request, static SQL with `?` parameters, JSON errors (400/404/405/503), loopback-only binding,
  `OPENCODE_DB_PATH`/`PORT` configuration (paths only, no secrets), startup prints the local-only warning.
- **T4 (observed)**: SPA in `apps/dashboard/src/` — summary cards, filter bar (time range presets + custom
  range, agent, model, project, root/child), session table, parent/child detail tree, loading/error/empty
  states, unknown-cost `—` rendering, always-visible local privacy notice.
- **T5 (observed)**: scripts `dev`, `build`, `start`, `api`, `lint`, `typecheck`, `test` (+`test:client`,
  `test:server`); docs `README.md` (Session dashboard section) and `docs/session-dashboard.md` (architecture,
  safe schema/read model, startup, routing validation, privacy, cost limitations, troubleshooting).
- **T6 (observed 2026-09-30)**: `npm test` exit 0 — 27/27 adapter tests (`node --test`) and 38/38 SPA tests
  (vitest); `npm run lint` exit 0; `npm run build` exit 0 (`tsc --noEmit` + `vite build`, 236 kB bundle);
  runtime harness: `npm run dev` (5173, API middleware) and `npm start` (8787, API + built SPA) both served
  `/api/health`, `/api/summary`, `/api/sessions`, detail, 400/404/405 paths and static/traversal checks against
  the live read-only database (22 sessions). `git diff --check` clean; changes confined to this repository.
  Dependency install: `npm install` inside `apps/dashboard` only (136 packages, runtime deps limited to
  `react` + `react-dom`); `dist/` added to `.gitignore`.
- **T8 (observed 2026-09-30)**: documented the two project-local MCP servers declared in `opencode.json`
  `mcp.servers` — `figma` (`type: remote`, `https://mcp.figma.com/mcp`, official endpoint, interactive
  OAuth on first connection) and `chrome-devtools` (`type: local`, `npx -y chrome-devtools-mcp@latest`,
  official Chrome DevTools MCP) — in `README.md` (new *Project-local MCP servers* section: scope, no
  secrets committed, Figma authorization, Chrome requirements, local browser tests, quick verification,
  troubleshooting) and in `docs/session-dashboard.md` (MCP subsection under *Privacy*, two troubleshooting
  rows, one checklist item). Evidence: `jq empty opencode.json` OK; `jq -r '.mcp.servers | keys[]'` →
  `figma`, `chrome-devtools`; `opencode mcp list` from the repository root → `chrome-devtools connected`,
  `figma needs authentication` (plus globally inherited `context7`, `engram`) — **no authenticated Figma
  connection was observed, so none is claimed**; `opencode debug config` shows `mcp` defined by the
  global file only for `context7`/`engram` and by this repository's file for `figma`/`chrome-devtools`
  (global config read for MCP server names only, never modified, no credentials inspected); Node
  v24.19.0 satisfies `chrome-devtools-mcp@1.10.1` engines (`^20.19 || ^22.12 || >=23`) and local Chrome
  is present at `/Applications/Google Chrome.app`. Gotcha recorded: `opencode debug config | jq` fails
  with `Unfinished string at EOF` because the output truncates on a pipe — redirect to a file first.
  No global config, source code or credential was touched.

## Next step

T7 only: publish to GitHub after the exact repository URL and explicit remote authorization are provided.
The dashboard itself is complete and runs locally; the MCP documentation unit (T8) is complete and
closes with a local work-unit commit.
