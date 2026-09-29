#!/usr/bin/env bash
#
# herdr-dat-ia.sh — Herdr helper for the dat-ia repository.
#
# STATUS: this script was NOT executed during repository setup. The read-only subcommands were
# validated against Herdr 0.9.2; the mutating subcommand is documented but unvalidated.
#
# Safety rules:
#   * read-only by default — only `open-session` mutates, and it refuses to run without --yes;
#   * it never closes, moves or focuses existing panes;
#   * never run it against a Herdr session you do not own.
#
# Subcommands:
#   detect        Check HERDR_ENV=1 and print workspace/tab/pane env values (read-only)
#   inspect       Run read-only inspection commands (never mutates)
#   open-session  Split the current pane and start OpenCode in it (MUTATING, needs --yes)
#
# Requires: herdr CLI on PATH, jq for output parsing, and a Herdr-managed environment
# (HERDR_ENV=1) for detect and open-session.

set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "error: jq is required but not on PATH" >&2
    exit 1
  fi
}

require_herdr() {
  if ! command -v herdr >/dev/null 2>&1; then
    echo "error: herdr CLI not found on PATH" >&2
    exit 1
  fi
}

require_herdr_env() {
  require_herdr
  if [ "${HERDR_ENV:-}" != "1" ]; then
    echo "error: not inside a Herdr-managed pane (HERDR_ENV=${HERDR_ENV:-<unset>})" >&2
    echo "       run this from a pane managed by Herdr with HERDR_ENV=1" >&2
    exit 1
  fi
}

run_readonly() {
  echo "==> $*"
  "$@" || echo "    (command failed)" >&2
}

cmd_detect() {
  require_herdr_env
  echo "HERDR_ENV=$HERDR_ENV"
  echo "HERDR_WORKSPACE_ID=${HERDR_WORKSPACE_ID:-<unset>}"
  echo "HERDR_TAB_ID=${HERDR_TAB_ID:-<unset>}"
  echo "HERDR_PANE_ID=${HERDR_PANE_ID:-<unset>}"
}

cmd_inspect() {
  require_herdr
  run_readonly herdr status
  run_readonly herdr workspace list
  run_readonly herdr pane current --current
  run_readonly herdr agent list
}

cmd_open_session() {
  local confirmed=0
  for arg in "$@"; do
    case "$arg" in
      --yes) confirmed=1 ;;
      *)
        echo "unknown argument: $arg" >&2
        exit 2
        ;;
    esac
  done

  cat >&2 <<'WARNING'
WARNING — MUTATING OPERATION
  * This splits the current pane and starts an OpenCode agent in the new pane.
  * It was NOT executed during repository setup and is unvalidated.
  * Run it only with explicit authorization and only in a session you own.
  * It never closes, moves or focuses existing panes.
WARNING

  if [ "$confirmed" -ne 1 ]; then
    echo "refusing to run without --yes; re-run as:" >&2
    echo "  bash scripts/herdr-dat-ia.sh open-session --yes" >&2
    exit 1
  fi

  require_herdr_env
  require_jq

  echo "==> herdr pane split --current --direction right --cwd $REPO_ROOT --no-focus"
  split_json="$(herdr pane split --current --direction right --cwd "$REPO_ROOT" --no-focus)"
  pane_id="$(printf '%s' "$split_json" | jq -r '.result.pane.pane_id // empty')"

  if [ -z "$pane_id" ]; then
    echo "error: could not parse the new pane id from herdr output:" >&2
    printf '%s\n' "$split_json" >&2
    exit 1
  fi

  echo "==> herdr agent start dat-ia-opencode --kind opencode --pane $pane_id"
  herdr agent start dat-ia-opencode --kind opencode --pane "$pane_id"
  echo "requested OpenCode session 'dat-ia-opencode' in pane $pane_id (cwd: $REPO_ROOT)"
}

case "${1:-}" in
  detect)
    shift
    cmd_detect "$@"
    ;;
  inspect)
    shift
    cmd_inspect "$@"
    ;;
  open-session)
    shift
    cmd_open_session "$@"
    ;;
  ""|help|-h|--help)
    usage
    ;;
  *)
    echo "unknown subcommand: $1" >&2
    usage >&2
    exit 2
    ;;
esac
