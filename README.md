# dat-ia — OpenCode + Gentle AI + Herdr + Engram integration

This repository centralizes and documents the local integration of OpenCode v2, Gentle AI
(gentle-ai), Herdr and Engram, and ships a repository-scoped OpenCode profile that uses **free
models only** (the "free profile"). The global paid configuration stays untouched; nothing outside
this repository changes.

**Verified**: 2026-09-30 against OpenCode v2.0.19, gentle-ai 3.7.0, Herdr 0.9.2, Engram 2.2.1.

## Repository map

| Path | Purpose |
|------|---------|
| `opencode.json` | Project-scoped free profile: model-only overrides for 14 agents plus the root model, and two project-local MCP servers (`figma`, `chrome-devtools`) |
| `docs/architecture.md` | Layers, versions, configuration precedence, agent inventory, fidelity notes, drift risks |
| `docs/free-profile.md` | Profile design, mechanism, allowlist, exclusions, refresh and verification procedure |
| `docs/herdr-opencode-integration.md` | Herdr requirements, read-only inspection, session-opening steps (not executed) |
| `docs/engram-sessions.md` | Engram memory integration, project resolution, topic keys, read-back commands |
| `docs/session-dashboard.md` | Dashboard architecture, safe read model, startup, routing validation, privacy, cost limits, troubleshooting |
| `apps/dashboard/` | Local session observability dashboard: read-only Node API adapter + Vite/React/TypeScript SPA |
| `scripts/validate-free-profile.sh` | Fail-closed validation: static allowlist, model catalog, effective agent resolution |
| `scripts/herdr-dat-ia.sh` | Herdr detect/inspect (read-only) and opt-in session-opening helper |
| `odd/tasks/dat-ia-integration.md` | ODD task record with the evidence log |

## Quick path: select, verify, fall back

1. **Select** — open OpenCode with a workspace anywhere inside this repository (repo root or any
   subdirectory). The project config auto-loads and the free profile applies.
2. **Verify** — run `opencode debug agents` and confirm the 14 profile agents resolve to free
   models; or run `bash scripts/validate-free-profile.sh` for a full check.
3. **Fall back** — rename or remove `opencode.json` (or work from another directory) to use the
   global paid configuration again. `git restore opencode.json` recovers it.

Optional user action: copy `opencode.json` into another project as that project's config to reuse
the free profile there. This repository does not do that automatically.

## Paid vs free configuration

| Scope | Where | Models | Changed by this repository |
|-------|-------|--------|----------------------------|
| Global, machine-wide | `~/.config/opencode/opencode.json` | Paid, gentle-ai managed | No |
| This repository | `./opencode.json` | Free only | Yes — this is the profile |

Global paid assignments (brief, provider `opencode-go` unless noted): `gentle-orchestrator` =
`gpt-6-luna#medium`; `general` = `gpt-6-luna#low`; `sdd-propose` / `sdd-spec` / `sdd-tasks` /
`sdd-research` = `gpt-6-luna#medium`; `sdd-archive` / `sdd-init` = `gpt-6-luna#low`;
`sdd-onboard` = `gpt-6-luna#medium`; `sdd-apply` / `sdd-explore` = `mimo-v2.6-flash`;
`sdd-design` / `sdd-verify` = `mimo-v2.6-pro`; `explore` is already free
(`opencode/mimo-v2.6-flash-free`). Review and `jd-*` agents have no model configured. Details in
`docs/architecture.md`.

## Free profile assignments

| Agent | Effective model |
|-------|-----------------|
| root default (`model`) | `opencode/mimo-v2.6-flash-free` |
| `gentle-orchestrator` | `opencode/mimo-v2.6-flash-free` |
| `explore` | `opencode-go/space-bunny-free#low` |
| `general` | `opencode/mimo-v2.6-flash-free` |
| `sdd-explore` | `opencode/mimo-v2.6-flash-free` |
| `sdd-propose` | `opencode/mimo-v2.6-flash-free` |
| `sdd-spec` | `opencode/mimo-v2.6-flash-free` |
| `sdd-design` | `opencode/mimo-v2.6-flash-free` |
| `sdd-tasks` | `opencode/mimo-v2.6-flash-free` |
| `sdd-apply` | `opencode/mimo-v2.6-flash-free` |
| `sdd-verify` | `opencode/mimo-v2.6-flash-free` |
| `sdd-archive` | `opencode/mimo-v2.6-flash-free` |
| `sdd-init` | `opencode/mimo-v2.6-flash-free` |
| `sdd-onboard` | `opencode/mimo-v2.6-flash-free` |
| `sdd-research` | `opencode/mimo-v2.6-flash-free` |
| Documented manual fallback | `opencode-go/longcat-2.5-preview-free` |

Inside each agent definition the profile overrides only `model` fields: prompts, permissions,
skills and plugins stay inherited from the global configuration — see `docs/free-profile.md`.
The top-level `mcp.servers` key is separate and adds two project-local MCP servers, described
next.

## Project-local MCP servers

Two official MCP servers are declared in `./opencode.json` under `mcp.servers`, so **only**
OpenCode sessions opened inside this repository load them. The global configuration is
untouched, and the file itself contains no secrets — only a URL and a command.

| Server | Type | Endpoint / command | Authentication |
|--------|------|--------------------|----------------|
| `figma` | `remote` | `https://mcp.figma.com/mcp` (official Figma remote endpoint) | OAuth, interactive, on first connection |
| `chrome-devtools` | `local` | `npx -y chrome-devtools-mcp@latest` (official Chrome DevTools MCP) | None — runs on this machine |

| Topic | What to expect |
|-------|----------------|
| Scope | Project-local: sessions started outside this repository do not see these servers. Delete the `mcp` block to opt out; `git restore opencode.json` restores it |
| Secrets | No tokens, client secrets, cookies or OAuth state are committed — `opencode.json` holds a URL and a command. OpenCode keeps the Figma OAuth credential outside the repository (see `opencode debug paths`); `.gitignore` already excludes `.env*` |
| Figma authorization | Interactive: the first connection opens a browser OAuth flow (`opencode mcp auth figma` starts it explicitly). **Not authenticated in this environment** — `opencode mcp list` reported `figma needs authentication` on 2026-09-30. When you do use it, the design data you query is sent to Figma's servers |
| Chrome requirements | `npx -y` resolves the newest published package on first use (observed `chrome-devtools-mcp@1.10.1`), Node must satisfy the package engines `^20.19 \|\| ^22.12 \|\| >=23` (observed Node v24.19.0), and a local Chrome/Chromium build must be installed (observed `/Applications/Google Chrome.app`) |
| Browser tests stay local | The server drives a browser on this machine against local URLs (for example the dashboard on `127.0.0.1:5173`); the dashboard's data path never crosses an MCP server, and nothing about sessions or costs is sent to Figma |

### Quick verification

```bash
jq empty opencode.json                    # config parses
jq -r '.mcp.servers | keys[]' opencode.json   # figma / chrome-devtools
opencode mcp list                         # runtime status — run from inside this repository
```

Observed on 2026-09-30 from the repository root: `chrome-devtools connected`,
`figma needs authentication`, plus `context7` and `engram` inherited from the global
configuration. `opencode debug config` confirms the split: the global file defines
`context7`/`engram`, this repository's file defines `figma`/`chrome-devtools`. Project scoping is
observable: running `opencode mcp list` from the parent directory (outside this repository)
lists only `context7` and `engram`.

### Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `figma — needs authentication` | OAuth has not been completed on this machine (expected on first use) | Run `opencode mcp auth figma` and finish the browser flow, then re-check with `opencode mcp list`. `opencode mcp logout figma` removes the stored credential |
| `chrome-devtools` never reaches `connected` | First `npx` run needs network access to resolve the package, Node is below the package engines, or no local Chrome is installed | `npx -y chrome-devtools-mcp@latest --help`, `node --version`, and check `/Applications/Google Chrome.app` |
| `figma`/`chrome-devtools` missing from `opencode mcp list` | The command was run outside the repository, so the project config did not load | Run it from inside `dat-ia` |
| `opencode debug config \| jq` fails with `Unfinished string at EOF` | Observed: the JSON is truncated when stdout is a pipe | Redirect to a file first (`opencode debug config > /tmp/oc.json`) and run `jq` on the file |

## Session dashboard

A local-only observability dashboard for OpenCode sessions lives in `apps/dashboard/` — a
Vite + React + TypeScript SPA plus a small Node API adapter. The browser never opens SQLite: the
adapter reads `~/.local/share/opencode/opencode.db` **read-only** (configurable via
`OPENCODE_DB_PATH`) and returns an allowlisted session DTO. No prompts, messages, credentials,
account data, events, share URLs or raw metadata are ever sent to the page, and the server binds
to `127.0.0.1` only.

```bash
cd apps/dashboard
npm install          # first run only; installs locally inside apps/dashboard
npm run dev          # SPA + API on http://127.0.0.1:5173
npm test             # adapter tests (node --test) + SPA tests (vitest)
npm run lint         # ESLint (flat config)
npm run build        # tsc --noEmit && vite build
npm start            # built SPA + API on http://127.0.0.1:8787
```

It lists **tasks**: one row per orchestrator (root) session, with every subagent session below it
folded in and classified by agent. Clicking a task opens a modal with the spend by agent and each
subagent call (model, duration, tokens, cost). A **monthly budget panel** shows a progress bar of
usage against the limit of each model — copy `apps/dashboard/budgets.example.json` to
`budgets.json` and set your limits. Summary totals and filters (time range, agent used, model
used, project) complete the page. Registered cost values only — a session without a registered
cost shows `—` and is excluded from totals. Full details: architecture, safe schema/read model,
tasks, monthly budgets, startup, routing validation, privacy, cost limitations and troubleshooting
in `docs/session-dashboard.md`.

## Privacy warnings

| Model | Terms to know before use |
|-------|--------------------------|
| `opencode/mimo-v2.6-flash-free` | Free for a limited time; during its free period, collected data may be used to improve the model. Do **not** use it for sensitive or confidential content. |
| `opencode-go/space-bunny-free` | Provider follows a zero-retention policy and does not use data for model training. |
| `opencode-go/longcat-2.5-preview-free`, `opencode/longcat-2.5-preview-free` | Same zero-retention / no-training statement. |
| `opencode/nemotron-3-ultra-free`, `opencode/nemotron-3.5-lightning-free` | Trial use only; do not submit personal or confidential data. |
| `opencode/ling-3.0-flash-fin-free`, `opencode/big-pickle` | Check current provider terms before using sensitive data. |
| Excluded: `opencode/muse-spark-1.3-contributor-free` | Not on the acceptable-free list, and its terms permit prompt/completion training. Never add it to the profile. |

All Console-hosted models are hosted in the US. Provider terms change; re-check the current terms
before relying on any of these models for confidential material.

## Herdr requirements

Herdr 0.9.2+ is required for the pane integration, with the server running and the `herdr` CLI on
`PATH`. Herdr-managed panes export `HERDR_ENV=1` plus `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID` and
`HERDR_PANE_ID`. State was validated read-only on 2026-09-30 (workspace `w2`, panes `w2:p1` and
`w2:p2`). See `docs/herdr-opencode-integration.md`.

## Engram sessions

Memory is stored through the Engram MCP server (local, configured globally) and the Engram CLI.
This repository uses the topic keys `dat-ia/architecture/herdr-opencode-gentleman`,
`dat-ia/config/free-agent-profile` and `dat-ia/integration/verification`; project resolution from
`~/Desktop/Development` is ambiguous, so `--project dat-ia` is used explicitly. Never store
secrets, tokens or environment values in memory. See `docs/engram-sessions.md`.

## Verify and recover

```bash
# From the repository root
jq empty opencode.json
bash scripts/validate-free-profile.sh
opencode debug agents
opencode mcp list
git status --short
git log --oneline
```

Recovery: rename or remove the profile (`mv opencode.json opencode.json.disabled` or
`rm opencode.json`) to return to the global configuration; `git restore opencode.json` restores
the committed version.

## Status and limitations

- **Verified**: profile resolves in v2.0.19 — 14 agents effective on free models; agent merge
  preserves prompts and permissions; validator passes; JSON valid. Project-local MCP config
  parses and loads: `opencode mcp list` reports `chrome-devtools connected` (observed 2026-09-30).
- **Pending**: the `figma` server was reported `needs authentication` — no authenticated Figma
  MCP connection was observed, so none is claimed; authorize it interactively when needed. Also
  pending: Herdr session-opening was not executed by policy (no live session control without
  explicit authorization); the global config uses V1 `#variant` model strings that resolve to
  `null` in v2.0.19 (observation only, not fixed here); Engram writes require explicit project
  resolution and are handled by the orchestrator session.
