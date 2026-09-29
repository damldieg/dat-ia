# ODD Task: dat-ia integration repository

**Feature**: dat-ia-integration
**Repository**: /Users/damiandiego/Desktop/Development/dat-ia
**Created**: 2026-09-30
**Route**: Delegated direct — one bounded writer (`general`) for repository content; orchestrator keeps inspection, Engram writes, and validation.
**Delivery**: Local commits only. No remote operations were authorized for this task (no push, no PRs).

## Objective

Create and document a local integration repository that centralizes the configuration of OpenCode,
Gentle AI (gentle-ai), Herdr and Engram, and provides a repository-scoped OpenCode profile restricted
to free models only.

## Authorized scope

- `/Users/damiandiego/Desktop/Development/dat-ia/**` (create)
- `~/.config/opencode/opencode.json` and `~/.config/opencode/agents/**` only if strictly necessary
  (not expected; the global paid configuration is preserved untouched)
- No remote operations, no SSH, no push, no PRs, no credentials.

## Constraints (hard)

1. Preserve the paid global configuration (gentle-ai-managed) untouched.
2. Free profile: free models only; no silent substitutions; Muse Spark Contributor excluded
   (not free, and its terms permit prompt/completion training).
3. Do not modify Gentleman AI native review agents (`review-*`, `jd-*`); the profile overrides only
   `model` scalars of other agents.
4. New configuration uses the V2-native `agents` shape with expanded model objects (evidence: V1-style
   `#variant` model strings normalize to `null` in OpenCode v2.0.19).
5. No secrets, tokens, API keys, or environment values in files or Engram.
6. Herdr: read-only inspection only during this task; no pane/tab/workspace mutations.
7. Technical artifacts in English; conventional commits; no AI attribution.

## Tasks

- [x] **T1 — Inspection (orchestrator).** OpenCode v2.0.19; Herdr 0.9.2 active (HERDR_ENV=1, workspace
  `w2`, pane `w2:p1`); Engram v2.2.1; global config uses `agent` (singular, V1-compat shape) with 23
  agents managed by gentle-ai/sdd v3.7.0; `opencode models` catalog captured; merge semantics and
  model-form behavior verified empirically (mt-v1 / mt-v2 tests in a temp directory).
- [x] **T2 — Repository bootstrap**: `git init`, `.gitignore`, `README.md`, `docs/`, `odd/`.
- [x] **T3 — Free profile** `opencode.json` (project-scoped, V2-native `agents`, expanded model objects).
- [x] **T4 — Documentation set** (README + `docs/architecture.md`, `docs/free-profile.md`,
  `docs/herdr-opencode-integration.md`, `docs/engram-sessions.md`).
- [x] **T5 — Scripts** (`scripts/validate-free-profile.sh`, `scripts/herdr-dat-ia.sh`).
- [x] **T6 — Engram memory**: topics `dat-ia/architecture/herdr-opencode-gentleman`,
  `dat-ia/config/free-agent-profile`, `dat-ia/integration/verification` + read-back — completed 2026-09-30
  (observations #8, #9, #10; read-back verified; relation judgments resolved as `related`).
- [x] **T7 — Validation suite** (completed 2026-09-30): JSON validity, `opencode models`, `opencode auth list`,
  `opencode reload`, free-model existence, no-paid-model check, `git diff --check`, `git status`, docs check,
  Engram check, Herdr read-only check, and two free-model inference smoke tests (documented consumption —
  no paid inference).
- [x] **T8 — Local commits** (work units) + delivery report: `a1c1af4`, `5dd1322`; this task log is
  finalized by a follow-up evidence commit.

## Evidence log

- **T1**: Global config inspected (`agent` singular confirmed). Model assignments extracted. Empirical tests:
  (a) project-scope `model`-only override preserves agent prompt/permissions (merge by scalar, `system` and
  `permissions` lengths unchanged); (b) V1 `#variant` string models normalize to `null`; (c) V2 expanded
  object `{providerID, model, variant}` survives resolution. Free-model catalog captured via `opencode models`.
  Herdr live state captured read-only (`herdr status`, `workspace list`, `pane current`, `pane list`,
  `agent list`, `pane layout`).
- **T2**: `git init -b main`; `.gitignore` (macOS, logs, Node, env files) added; layout `docs/`, `scripts/`,
  `odd/tasks/`.
- **T3**: `opencode.json` written with the V2-native `agents` shape and expanded model objects; root
  `model` plus 14 agent overrides; no paid model referenced.
- **T4**: `README.md` and `docs/{architecture,free-profile,herdr-opencode-integration,engram-sessions}.md`
  written; architecture includes the merge/`#variant` evidence, `.opencode/` precedence and subdirectory
  discovery results.
- **T5**: `scripts/validate-free-profile.sh` and `scripts/herdr-dat-ia.sh` added; `bash -n` clean; validator
  reported `RESULT: OK` with all 14 effective agents on the free allowlist. `herdr-dat-ia.sh` was not
  executed (read-only by default; `open-session` remains unvalidated by policy).
- **T6**: Engram observations saved under project `dat-ia`: #8 `dat-ia/architecture/herdr-opencode-gentleman`,
  #9 `dat-ia/config/free-agent-profile`, #10 `dat-ia/integration/verification`. Read-back verified via
  `mem_search` (project-scoped), `engram search` and `engram timeline`. Three auto-detected conflict
  relations judged `related`. Notes: MCP project detection from the parent folder is ambiguous
  (`claude-toolkit` / `dat-ia`); writes used the documented alternative of operating from inside the repo;
  `mem_get_observation` (no project parameter) cannot resolve from this host, so the full-content read-back
  used the CLI.
- **T7**: Validator 20 PASS / 0 FAIL; `opencode debug agents` → 14 agents, all free; free-model smoke tests
  passed (`opencode run` with the root model and with the `space-bunny-free#low` variant); `opencode reload`
  OK; `opencode models` / `auth list` re-checked; `git diff --check` clean; global paid config untouched
  (mtime predates the repo; no dat-ia references). Independent verifier: VERIFIED WITH FINDINGS — no
  blockers; one documentation wording nit fixed in this commit.
- **T8**: Work-unit commits `a1c1af4` (docs) and `5dd1322` (profile + tooling); final evidence commit follows
  this log update.

## Pending / risks

- Paid global config uses V1 `#variant` model strings that resolve to `null` in v2.0.19 (observation only —
  out of scope to modify). Flagged in the delivery report.
- Engram project auto-detection is ambiguous from `~/Desktop/Development` (multiple git repos); writes were
  resolved by operating from inside the repo and passing `project: dat-ia` explicitly.
- Herdr session-opening flow is documented but intentionally not executed during setup (policy: no
  mutations, no live session control without explicit authorization).
- OpenCode is not eligible for native immutable receipt review (`gentle-ai review assess`:
  high / unassessable; supported runtimes: claude-code, codex). The tool suggests the clone-scope exit
  `gentle-ai review mode disable --scope clone --cwd <repo>` — reported to the user, intentionally not
  executed (user-owned switch).
