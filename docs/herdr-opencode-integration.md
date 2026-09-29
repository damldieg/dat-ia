# Herdr × OpenCode integration

Herdr runs OpenCode sessions inside panes and exposes workspace, tab and pane identity to the
processes it hosts. This document covers the requirements, the read-only inspection workflow that
was validated on 2026-09-30, and the session-opening steps — which are **mutating and were not
executed during setup** by policy.

## Requirements

| Requirement | Detail |
|-------------|--------|
| Herdr 0.9.2+ | Verified on 0.9.2 (stable channel), protocol 22 |
| Server running | `herdr status` reports `server.status: running` |
| `herdr` CLI on `PATH` | `/opt/homebrew/bin/herdr` on this machine |
| Herdr-managed pane | Panes export `HERDR_ENV=1`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID` |
| OpenCode available | `opencode` on `PATH` inside the pane; the repository profile loads from cwd |

Herdr also ships an optional installer (`herdr integration install opencode`). The flow below does
not depend on it: `herdr agent start --kind opencode` starts OpenCode in an existing pane.

## Detect the Herdr environment

```bash
test "${HERDR_ENV:-}" = 1 && echo "inside Herdr" || echo "not inside Herdr"
```

`scripts/herdr-dat-ia.sh detect` performs the same check and prints the pane identity variables; it
exits non-zero outside Herdr.

## Identify workspace, tab and pane

| Variable | Meaning | Captured example (2026-09-30) |
|----------|---------|-------------------------------|
| `HERDR_WORKSPACE_ID` | workspace holding the pane | `w2` |
| `HERDR_TAB_ID` | tab holding the pane | `w2:t1` |
| `HERDR_PANE_ID` | the pane itself | `w2:p1` |

## Read-only inspection

```bash
herdr status
herdr workspace list
herdr pane current --current
herdr pane list --workspace "$HERDR_WORKSPACE_ID"
herdr agent list
herdr pane layout --pane "$HERDR_PANE_ID"
```

`scripts/herdr-dat-ia.sh inspect` runs the first four of these and never mutates state. All Herdr
CLI responses are JSON; add `| jq` when you need to filter.

## Opening an OpenCode session in dat-ia

> **MUTATING — not executed during repository setup.** These commands create a pane and start an
> agent in it. Run them only with explicit authorization and only in a session you own; never
> close or move panes that belong to another session.

Herdr requires the target pane to be at an interactive shell prompt before `agent start` succeeds.
The two steps, as implemented by `scripts/herdr-dat-ia.sh open-session --yes`:

```bash
# Step 1 — create a sibling pane (MUTATING)
herdr pane split --current --direction right \
  --cwd /Users/damiandiego/Desktop/Development/dat-ia --no-focus

# Step 2 — start OpenCode in the new pane (MUTATING; <pane-id> from step 1 output,
#          JSON path .result.pane.pane_id)
herdr agent start dat-ia-opencode --kind opencode --pane <pane-id>
```

The script refuses to run without `--yes` and prints the mutation warning first. Because the pane
cwd is the repository root, the project-scoped free profile loads automatically.

## Inspection vs mutation

| Operation | Command | Type | Executed during setup |
|-----------|---------|------|-----------------------|
| Server/client status | `herdr status` | read-only | yes |
| List workspaces | `herdr workspace list` | read-only | yes |
| Current pane | `herdr pane current --current` | read-only | yes (from a Herdr pane) |
| List panes | `herdr pane list --workspace <id>` | read-only | yes |
| List agents | `herdr agent list` | read-only | yes |
| Pane layout | `herdr pane layout --pane <id>` | read-only | yes |
| Split pane | `herdr pane split ...` | **mutating** | no (policy) |
| Start agent | `herdr agent start ...` | **mutating** | no (policy) |

## Live validation — 2026-09-30 (read-only)

| Command | Result |
|---------|--------|
| `herdr --version` | `herdr 0.9.2`, stable channel |
| `herdr status` | client 0.9.2, protocol 22; server running, compatible, no restart needed |
| `herdr workspace list` | one workspace `w2`, label `[1] ~`, 2 tabs, 2 panes, focused |
| `herdr pane current --current` | pane `w2:p1`, tab `w2:t1`, OpenCode agent, status working |
| `herdr pane list --workspace w2` | `w2:p1` (OpenCode, working, focused) and `w2:p2` (OpenCode, idle) |
| `herdr agent list` | two agents of kind `opencode`, in panes `w2:p1` and `w2:p2` |
| `herdr pane layout --pane w2:p1` | single pane filling tab `w2:t1` (205×74), focused, not zoomed |

The `herdr agent list` output confirms `opencode` is a supported agent kind.

## Pending

- Session opening (pane split + agent start) is documented but **unvalidated** — it was not
  executed during setup by policy. Validate it in a disposable pane with
  `scripts/herdr-dat-ia.sh open-session --yes` when live session control is explicitly authorized.
- Herdr version compatibility beyond 0.9.2 has not been tested.
