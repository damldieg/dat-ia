# Free profile

The repository-scoped OpenCode profile (`opencode.json`) pins every agent it can to **free models
only**, without touching the global paid configuration. It was verified against OpenCode v2.0.19 on
2026-09-30: all 14 targeted agents resolve to free models, and inherited prompts and permissions
are preserved.

## Purpose and design

- Enforce a free-only rule for sessions opened inside this repository.
- Keep the override surface minimal: one `model` field per agent, nothing else.
- Avoid duplicated agent definitions: no prompt copies, no permission copies, no drift.
- Fail closed: if a referenced model is not on the allowlist, the validator fails instead of
  substituting silently.

## Mechanism

The profile is merged over the global configuration by the project config source. Because agent
definitions merge by field, defining only `model` for an agent overrides its model while its
prompt, permissions, mode, skills, MCP servers and plugins remain inherited from the
gentle-ai-managed global definition.

Evidence (OpenCode v2.0.19, captured 2026-09-30):

| Agent | Inherited `system` length | Inherited permission rules | Model override applied |
|-------|---------------------------|----------------------------|------------------------|
| `explore` | 2,345 chars | 28 | `opencode-go/space-bunny-free#low` |
| `general` | 2,226 chars | 12 | `opencode/mimo-v2.6-flash-free` |
| `gentle-orchestrator` | 90,038 chars | 33 | `opencode/mimo-v2.6-flash-free` |
| `sdd-apply` | 2,160 chars | 9 | `opencode/mimo-v2.6-flash-free` |

### Why `-free`-suffixed agent copies were not needed

Creating separate `sdd-apply-free`-style agents was considered and rejected: it would duplicate
prompts and permissions, and every gentle-ai sync would create drift. The merge evidence above
shows a single-field override is sufficient — prompts and permissions survive untouched. This is
the reason the profile contains no `-free` agent names and no prompt text.

**When replication would become necessary**: if a future OpenCode version stops merging agent
fields (i.e. a project-level agent definition replaces the whole agent), or if a config schema
change removes partial overrides, this profile must be re-evaluated and the agents replicated in
full. Re-check the merge probe documented in `docs/architecture.md` after every OpenCode upgrade.

## Assignment table

| Agent | Model | Rationale |
|-------|-------|-----------|
| root default `model` | `opencode/mimo-v2.6-flash-free` | Session default for any agent not listed below |
| `gentle-orchestrator` | `opencode/mimo-v2.6-flash-free` | Primary free workhorse; orchestrates SDD without paid fallback |
| `explore` | `opencode-go/space-bunny-free#low` | Fast read-only reconnaissance; `low` variant keeps latency down |
| `general` | `opencode/mimo-v2.6-flash-free` | General fallback agent inside the free boundary |
| `sdd-explore` | `opencode/mimo-v2.6-flash-free` | SDD exploration phase |
| `sdd-propose` | `opencode/mimo-v2.6-flash-free` | SDD proposal phase |
| `sdd-spec` | `opencode/mimo-v2.6-flash-free` | SDD specification phase |
| `sdd-design` | `opencode/mimo-v2.6-flash-free` | SDD design phase |
| `sdd-tasks` | `opencode/mimo-v2.6-flash-free` | SDD task planning phase |
| `sdd-apply` | `opencode/mimo-v2.6-flash-free` | SDD implementation phase |
| `sdd-verify` | `opencode/mimo-v2.6-flash-free` | SDD verification phase |
| `sdd-archive` | `opencode/mimo-v2.6-flash-free` | SDD archive phase |
| `sdd-init` | `opencode/mimo-v2.6-flash-free` | Initialization phase (extension — see below) |
| `sdd-onboard` | `opencode/mimo-v2.6-flash-free` | Onboarding phase (extension — see below) |
| `sdd-research` | `opencode/mimo-v2.6-flash-free` | Research phase (extension — see below) |

### Extensions beyond the initial set

`sdd-init`, `sdd-onboard` and `sdd-research` are pinned even though an initial pass might list only
the main SDD phases. Rationale: the free-profile rule is *no paid models anywhere*. All three carry
paid global assignments (`gpt-6-luna#low` / `#medium`), so leaving them unpinned would silently
re-introduce paid models into an otherwise free workflow.

## Free allowlist and exclusions

Models accepted by the validator:

| Model | Notes |
|-------|-------|
| `opencode/mimo-v2.6-flash-free` | Profile default; see privacy note in README |
| `opencode-go/space-bunny-free` | Used for `explore` with variant `low` |
| `opencode-go/longcat-2.5-preview-free` | Documented manual fallback |
| `opencode/longcat-2.5-preview-free` | Zero-retention free tier |
| `opencode/ling-3.0-flash-fin-free` | Free tier |
| `opencode/nemotron-3-ultra-free` | Trial use |
| `opencode/nemotron-3.5-lightning-free` | Trial use |
| `opencode/space-bunny-free` | Same provider policy as the Go variant |
| `opencode/big-pickle` | Free tier |

Excluded: `opencode/muse-spark-1.3-contributor-free` — not on the acceptable-free list and its
terms permit prompt/completion training. It must never be added to the profile or the validator
allowlist.

The allowlist in `scripts/validate-free-profile.sh` must stay in sync with the official
OpenCode Console / Go documentation and with `opencode models`. It fails closed: an unknown model
is a validation failure, never a silent skip.

## Documented manual fallback

`opencode-go/longcat-2.5-preview-free` is the documented fallback if a provider outage or quota
exhausts the primary free model. OpenCode v2 has no documented per-agent fallback list, so this is
an operational choice: edit the affected `model` in `opencode.json`, run the validator, and commit
the change as its own work unit. It is not an automatic failover.

## Selection and verification

1. Open OpenCode with a workspace inside this repository; the profile applies automatically.
2. Verify:
   ```bash
   jq empty opencode.json
   bash scripts/validate-free-profile.sh
   opencode debug agents
   ```
3. Confirm `opencode debug agents` shows the 14 agents with non-null models, all free.

### Manual-selection caveat

A user can still select any model manually inside a session. The profile guarantees what the
configuration assigns — it does not and cannot restrict session-level user choices. Treat the
free-only rule as the default, not as a hard runtime lock.

## Refresh procedure after global config changes

1. Diff agent keys: `jq -r '.agent | keys[]' ~/.config/opencode/opencode.json` against the profile.
2. For every new or changed agent with a paid model, add a free `model` override here.
3. Re-check the chosen free models against `opencode models` and the Console privacy notes.
4. Run `bash scripts/validate-free-profile.sh`.
5. Commit the profile change as its own work unit.

## Integrity checks

`scripts/validate-free-profile.sh` performs, in order:

| Check | What it asserts |
|-------|-----------------|
| Static | `opencode.json` parses; every referenced provider/model pair is on the embedded allowlist |
| Catalog | Every referenced pair appears as an exact line in `opencode models` |
| Effective | Every agent with a non-null model in `opencode debug agents` is on the allowlist |

It never runs inference, never writes outside temporary files, and exits non-zero on any failure.
Use `--static-only` when OpenCode is not available; catalog and effective checks are then skipped
with an explicit note, and the run fails when OpenCode is missing without that flag.
