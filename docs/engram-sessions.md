# Engram sessions

Engram provides persistent memory for the agent sessions working on this repository. It runs as a
local MCP server (configured globally, `--tools=agent`) plus a CLI (`engram` v2.2.1) with
`search`, `context` and `save`. Memory writes for this repository are performed by the orchestrator
session; this repository only documents the keys and the read-back workflow.

## How memory integrates

| Piece | Detail |
|-------|--------|
| MCP server | Local command server configured in the global OpenCode config (`engram mcp --tools=agent`) |
| Plugin | `engram.ts` in the global plugin layer connects sessions to the memory server |
| CLI | `engram search`, `engram context`, `engram save` for read-back and manual writes |
| Scope | Decisions and summaries about this integration live under the Engram project `dat-ia` |

## Project detection behavior

Engram auto-detects the project from the current working directory. From
`~/Desktop/Development` that detection is **ambiguous** — the directory contains multiple git
repositories, and commands fail with an `ambiguous project: multiple git repos found in cwd` error.
This repository therefore uses explicit project resolution:

```bash
--project dat-ia
```

Until the orchestrator saves the first observation, the `dat-ia` project does not exist yet and
read commands report `unknown project: dat-ia`. That is expected and resolves after the first save.

## Topic keys

| Topic key | Contents |
|-----------|----------|
| `dat-ia/architecture/herdr-opencode-gentleman` | Architecture decisions: layers, precedence, merge findings, Herdr/OpenCode composition |
| `dat-ia/config/free-agent-profile` | The free-profile decision: assignments, allowlist, exclusions, fallback |
| `dat-ia/integration/verification` | Verification checkpoints: validator results, effective model resolution, commit evidence |
| `odd/dat-ia-integration/tasks` | ODD mirror: task status and evidence log for this integration |

## What is stored

- Architecture decisions and their rationale (including the merge and `#variant` findings).
- The free-profile decision and its refresh procedure.
- Verification checkpoints with exact commands and results.
- Session summaries for continuity across sessions.

**Never stored**: secrets, tokens, API keys, cookies, session identifiers or environment values.

## Read-back and recovery

```bash
# Search a topic or keyword
engram search "free-agent-profile" --project dat-ia

# Recent context from previous sessions
engram context dat-ia
```

Through MCP, the same information is available with `mem_search` (find observations) and
`mem_get_observation` (full, untruncated content). If a read-back returns nothing, check the
project name first — auto-detection ambiguity is the most common cause.
