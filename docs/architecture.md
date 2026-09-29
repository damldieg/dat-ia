# Architecture

This document describes how OpenCode v2, Gentle AI, Herdr and Engram are composed on this machine,
how configuration sources merge, and which parts this repository overrides. Everything below was
verified on 2026-09-30; re-validation triggers are at the end.

## Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│ L1  OpenCode client (TUI / CLI)                          v2.0.19     │
│       interactive session, tool execution, /sdd-* commands           │
├──────────────────────────────────────────────────────────────────────┤
│ L2  Global managed config   ~/.config/opencode/opencode.json         │
│       23 agents, __managed_by: gentle-ai/sdd, paid models            │
│       default_agent: gentle-orchestrator, share: disabled            │
├──────────────────────────────────────────────────────────────────────┤
│ L3  Project config (this repo)   ./opencode.json                     │
│       14 model overrides -> free models only                         │
├──────────────────────────────────────────────────────────────────────┤
│ L4  Plugin layer   ~/.config/opencode/plugins/                       │
│       engram.ts, herdr-agent-state.js, model-variants.ts,            │
│       opencode-review-transport.ts, sdd-task-result-artifacts.ts,    │
│       skill-registry.ts, telemetry-runtime.ts                        │
├──────────────────────────────────────────────────────────────────────┤
│ L5  Commands and skills   ~/.config/opencode/commands/ (/sdd-*),     │
│       ~/.config/opencode/skills/                                     │
├──────────────────────────────────────────────────────────────────────┤
│ L6  MCP servers                                                      │
│       context7 (remote)   ·   engram (local command)                 │
├──────────────────────────────────────────────────────────────────────┤
│ L7  Runtime environment                                              │
│       Herdr 0.9.2 (panes; HERDR_ENV=1, workspace/tab/pane ids)       │
│       Engram 2.2.1 (memory; MCP server + CLI, project dat-ia)        │
└──────────────────────────────────────────────────────────────────────┘
```

The free profile lives at L3 only. It is a thin overlay: it adds `model` values that win during
merge and leaves every other layer exactly as the global configuration defines it.

## Versions

| Component | Version | Notes |
|-----------|---------|-------|
| OpenCode (client + shared background service) | v2.0.19 | `opencode --version` |
| gentle-ai | 3.7.0 | `/opt/homebrew/bin/gentle-ai`; owns the global agent definitions |
| Herdr | 0.9.2, stable channel | server running, protocol 22 |
| Engram | 2.2.1 | MCP server (local) plus CLI with `search` / `context` / `save` |
| Config shape, global | V1-compat `agent` (singular) with string models | 23 agents, every one carries `__managed_by: gentle-ai/sdd` |
| Config shape, this repo | V2-native `agents` (plural) with expanded model objects | `{ "providerID", "model", "variant?" }` |

## Configuration precedence and merge semantics

`opencode debug config` from the repository root lists the discovered sources in this order:

| # | Source | Kind |
|---|--------|------|
| 1 | `~/.config/opencode/opencode.json` | global document |
| 2 | `~/.config/opencode/` | global directory |
| 3 | `<repo>/opencode.json` | project document |
| 4 | `<repo>/.opencode/opencode.json` and `<repo>/.opencode/` | project overrides, when present |

Merge semantics, verified empirically in v2.0.19:

| Behavior | Evidence |
|----------|----------|
| Agent definitions merge by field; a later source replaces only the fields it defines. | Overriding only `model` preserved each agent's `system` prompt and permissions: `explore` kept a 2,345-character system and 28 permission rules; `general` 2,226 and 12; `gentle-orchestrator` 90,038 and 33; `sdd-apply` 2,160 and 9. |
| Request maps merge by key; permission rules append. | Permissions counts above match the global definitions; no rules were lost. |
| A `.opencode/opencode.json` overlay wins over a direct `opencode.json`. | With a temporary overlay overriding `general` to `opencode/big-pickle`, the effective model became `big-pickle` while `explore` kept the direct profile value; after removing the overlay, `general` returned to `mimo-v2.6-flash-free`. |
| Project discovery walks up from subdirectories. | Running from `<repo>/docs/` still resolved `opencode-go/space-bunny-free#low` (explore) and `opencode/mimo-v2.6-flash-free` (general). |

## Agent inventory (23 gentle-ai-managed agents)

| Family | Agents | Model in global config | Overridden by this profile |
|--------|--------|------------------------|----------------------------|
| Orchestration | `gentle-orchestrator`, `general`, `explore` | paid (except `explore`, already free) | yes, all 3 |
| SDD | `sdd-explore`, `sdd-propose`, `sdd-spec`, `sdd-design`, `sdd-tasks`, `sdd-apply`, `sdd-verify`, `sdd-archive`, `sdd-init`, `sdd-onboard`, `sdd-research` | paid | yes, all 11 |
| Native review | `review-readability`, `review-refuter`, `review-reliability`, `review-resilience`, `review-risk`, `review-validator` | none configured | no |
| Judgment day | `jd-fix-agent`, `jd-judge-a`, `jd-judge-b` | none configured | no |

The profile never defines prompts, permissions or modes for these agents; it only adds `model`.
Review and `jd-*` agents are intentionally untouched.

## Configuration fidelity notes

1. **V1 `#variant` strings do not resolve (global config observation).** From a non-project
   directory, 9 of the 14 modeled agents resolve to `null` in `opencode debug agents` — exactly the
   ones whose global value uses a `provider/model#variant` string: `gentle-orchestrator`, `general`,
   `sdd-archive`, `sdd-init`, `sdd-onboard`, `sdd-propose`, `sdd-research`, `sdd-spec`,
   `sdd-tasks`. Plain string models without a variant (`explore`, `sdd-apply`, `sdd-explore`,
   `sdd-design`, `sdd-verify`) still resolve. This is out of scope here and is reported as an
   observation only; the profile is not affected because it uses expanded objects.
2. **New overrides use expanded model objects.** Verified: `{ "providerID": "opencode-go",
   "model": "space-bunny-free", "variant": "low" }` resolves as `space-bunny-free#low`, whereas the
   same information as a `#variant` string would be lost (note 1).
3. **`opencode debug config` is not authoritative for agent models.** Its parsed-source view showed
   `null` for agent model strings that `opencode debug agents` resolves correctly. Use
   `opencode debug agents` for effective resolution.
4. **A root `model` string without a variant is accepted by the parser** (verified: the project
   document's root value was normalized to an expanded object in the parsed-source view), so the
   profile keeps the string form at the root and expanded objects per agent.

## Drift risks and re-validation

| Trigger | What to re-check | How |
|---------|------------------|-----|
| gentle-ai global sync / upgrade | agent set and paid assignments vs the profile keys; new agents with paid models need overrides | `bash scripts/validate-free-profile.sh` |
| OpenCode upgrade | merge semantics, `agents` shape support, `#variant` behavior, root/agent model forms | rerun the validator and the merge probe from `docs/free-profile.md` |
| Provider catalog or terms change | allowlist membership, privacy notes | `opencode models`, official OpenCode Console/Go docs |
| Profile edit | JSON validity, allowlist, effective resolution | `bash scripts/validate-free-profile.sh` |

Re-validation procedure after any trigger: (1) run the validator; (2) diff the global agent keys
against the profile keys; (3) spot-check `opencode debug agents` from the repository root and from
`docs/`; (4) update `docs/free-profile.md` and commit as a work unit.
