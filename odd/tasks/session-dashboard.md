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

## Acceptance criteria

- The browser never opens SQLite directly and no prompt/credential fields are exposed.
- The dashboard reports sessions, parent/child relationships, agents, models/variants, timing, tokens, and registered costs, including unknown-cost states.
- Loading, error, empty, filters, summary, table, and detail-tree states work locally.
- JSON/config validation, routing probe, tests, lint, build, `git diff --check`, status, secret scan, and remote inspection are recorded honestly.

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

## Next step

T7 only: publish to GitHub after the exact repository URL and explicit remote authorization are provided.
The dashboard itself is complete and runs locally.
