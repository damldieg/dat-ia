#!/usr/bin/env bash
#
# validate-free-profile.sh — fail-closed validation of this repository's free OpenCode profile.
#
# Checks (read-only, never runs inference):
#   1. Static    — opencode.json parses and every referenced provider/model pair is on the
#                  embedded allowlist. The allowlist fails closed: an unknown model is a
#                  failure, never a silent substitution.
#   2. Catalog   — every referenced pair appears as an exact line in `opencode models`.
#   3. Effective — every agent with a non-null model in `opencode debug agents` is allowlisted.
#
# The embedded allowlist MUST stay in sync with the official OpenCode Console / Go documentation
# and with `opencode models`. Update it only to add or remove free models deliberately.
# Muse Spark (any variant) must never be added.
#
# This script never launches inference and never writes outside a temporary directory.
#
# Usage:
#   bash scripts/validate-free-profile.sh [--static-only]
#
#   --static-only   Skip the catalog and effective checks (no OpenCode needed).
#                   Without this flag, a missing `opencode` binary is a failure.
#
# Exit codes: 0 = OK, 1 = one or more checks failed, 2 = usage error.

set -euo pipefail

cd "$(dirname "$0")/.."

PROFILE="opencode.json"
STATIC_ONLY=0

usage() {
  sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --static-only) STATIC_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Free model allowlist — keep in sync with the official Console / Go docs.
# ---------------------------------------------------------------------------
ALLOWLIST="
opencode/mimo-v2.6-flash-free
opencode-go/space-bunny-free
opencode-go/longcat-2.5-preview-free
opencode/longcat-2.5-preview-free
opencode/ling-3.0-flash-fin-free
opencode/nemotron-3-ultra-free
opencode/nemotron-3.5-lightning-free
opencode/space-bunny-free
opencode/big-pickle
"

is_allowlisted() {
  printf '%s\n' "$ALLOWLIST" | grep -qxF -- "$1"
}

FAILURES=0
fail() { printf 'FAIL: %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
pass() { printf 'PASS: %s\n' "$1"; }
note() { printf 'NOTE: %s\n' "$1"; }

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is required but not on PATH" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dat-ia-validate.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "== Free profile validation: $PROFILE =="

# --- 1. Static: JSON validity -------------------------------------------------
if jq empty "$PROFILE" 2>/dev/null; then
  pass "$PROFILE is valid JSON"
else
  fail "$PROFILE is not valid JSON"
  echo
  echo "RESULT: FAIL — $FAILURES problem(s) found"
  exit 1
fi

# Extract every referenced model as "provider/model" (string or expanded object).
refs="$(jq -r '
  [ .model ] + [ (.agents // {} | to_entries[] | .value.model) ]
  | map(select(. != null))
  | map(if type == "string" then . else (.providerID + "/" + .model) end)
  | unique
  | .[]
' "$PROFILE")"

if [ -z "$refs" ]; then
  fail "no model references found in $PROFILE"
  echo
  echo "RESULT: FAIL — $FAILURES problem(s) found"
  exit 1
fi

ref_count=0
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  ref_count=$((ref_count + 1))
  if is_allowlisted "$ref"; then
    pass "allowlisted: $ref"
  else
    fail "not on the free allowlist: $ref"
  fi
done <<EOF
$refs
EOF

# --- 2 and 3: catalog and effective resolution --------------------------------
if [ "$STATIC_ONLY" -eq 1 ]; then
  note "catalog check skipped (--static-only)"
  note "effective check skipped (--static-only)"
elif ! command -v opencode >/dev/null 2>&1; then
  fail "opencode is not on PATH (use --static-only to skip catalog and effective checks)"
else
  # Catalog: exact line match against `opencode models`.
  if opencode models > "$TMP_DIR/models.txt" 2>/dev/null; then
    while IFS= read -r ref; do
      [ -n "$ref" ] || continue
      if grep -qxF -- "$ref" "$TMP_DIR/models.txt"; then
        pass "in catalog: $ref"
      else
        fail "not present in 'opencode models' output: $ref"
      fi
    done <<EOF
$refs
EOF
  else
    fail "could not read the model catalog (opencode models failed)"
  fi

  # Effective: every non-null agent model must be allowlisted.
  agents_captured=0
  for attempt in 1 2 3 4 5; do
    opencode debug agents > "$TMP_DIR/agents.json" 2>/dev/null || true
    if jq -e 'type == "array" and length > 0' "$TMP_DIR/agents.json" >/dev/null 2>&1; then
      agents_captured=1
      break
    fi
    sleep 1
  done

  if [ "$agents_captured" -ne 1 ]; then
    fail "could not capture a valid 'opencode debug agents' document"
  else
    effective="$(jq -r '.[] | select(.model != null) | (.model.providerID + "/" + .model.id)' "$TMP_DIR/agents.json")"
    effective_count=0
    while IFS= read -r ref; do
      [ -n "$ref" ] || continue
      effective_count=$((effective_count + 1))
      if is_allowlisted "$ref"; then
        pass "effective model allowlisted: $ref"
      else
        fail "effective model not on the free allowlist: $ref"
      fi
    done <<EOF
$effective
EOF
    if [ "$effective_count" -eq 0 ]; then
      fail "no effective agent models found — is the project profile being loaded?"
    else
      pass "effective agents on free models: $effective_count"
    fi
  fi
fi

# --- Summary ------------------------------------------------------------------
echo
if [ "$FAILURES" -eq 0 ]; then
  echo "RESULT: OK — free profile verified ($ref_count model reference(s))"
  exit 0
fi
echo "RESULT: FAIL — $FAILURES problem(s) found"
exit 1
