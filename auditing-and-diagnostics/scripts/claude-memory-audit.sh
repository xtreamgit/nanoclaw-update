#!/usr/bin/env bash
# claude-memory-audit.sh
# Audit, prune, and regression-test Claude Code / NanoClaw agent memory
# to fight confabulation.
#
# Usage:
#   ./claude-memory-audit.sh audit    [target_dir]   Discover + audit all memory files
#   ./claude-memory-audit.sh backup   [target_dir]   Archive auto memory (timestamped tarball)
#   ./claude-memory-audit.sh reset    [target_dir]   Backup, then clear auto memory (interactive)
#   ./claude-memory-audit.sh inject   [target_dir]   Append verification-first rules to CLAUDE.md
#   ./claude-memory-audit.sh test     [target_dir]   Replay saved prompts headlessly
#
# Environment:
#   REPORT_DIR   Where reports/backups are written. IMPORTANT for NanoClaw:
#                set this to a host-only path (e.g. /var/lib/nanoclaw-audit)
#                so audit output is NEVER written inside a group folder that
#                gets mounted into an agent container.
#                Default: <target_dir>/.claude-audit (fine for plain Claude Code
#                projects, NOT for NanoClaw group folders).
#   STALE_DAYS   Age threshold in days for the STALE flag (default 30).
#
# Regression prompts: one prompt per .txt file in $REPORT_DIR/prompts/

set -euo pipefail

PROJECT_DIR="${2:-$(pwd)}"
TARGET_NAME="$(basename "$PROJECT_DIR")"
AUDIT_DIR="${REPORT_DIR:-$PROJECT_DIR/.claude-audit}"
STALE_DAYS="${STALE_DAYS:-30}"

# Resolve the auto-memory dir for this target, if any.
#
# Two cases:
#   1. NanoClaw agent group — the agent runs in a container whose workspace is
#      the group folder. If auto-memory is persisted to the workspace it lives
#      at <group>/memory. There is NO per-group dir under ~/.claude/projects/.
#   2. Plain Claude Code project — memory lives under ~/.claude/projects/<enc>/,
#      where <enc> is the absolute path with every '/' AND '.' turned into '-'
#      (e.g. /Users/hd/github.com/... -> -Users-hd-github-com-...).
#
# Deliberately NO greedy fallback: if nothing matches this specific target we
# return empty. The old code fell through to the first ~/.claude/projects/*/memory
# alphabetically, which attributed an unrelated project's memory to the target.
find_auto_memory_dir() {
  # Case 1: auto-memory persisted inside the target/group workspace.
  local dir="${PROJECT_DIR%/}"
  if [ -d "$dir/memory" ]; then
    echo "$dir/memory"
    return
  fi
  # Case 2: Claude Code project memory, keyed by the encoded absolute path.
  if [ -d "$HOME/.claude/projects" ]; then
    local key
    key=$(echo "$dir" | sed 's|[/.]|-|g')
    local cand="$HOME/.claude/projects/$key/memory"
    [ -d "$cand" ] && { echo "$cand"; return; }
  fi
  echo ""
}

list_memory_files() {
  # All files loaded (or loadable) at session start, broadest scope first
  set +e
  {
    # Managed policy (org-wide)
    ls /etc/claude-code/CLAUDE.md 2>/dev/null
    ls "/Library/Application Support/ClaudeCode/CLAUDE.md" 2>/dev/null
    # User scope
    ls "$HOME/.claude/CLAUDE.md" 2>/dev/null
    find "$HOME/.claude/rules" -name '*.md' 2>/dev/null
    # Project/group scope: walk from PROJECT_DIR up to /
    local d="$PROJECT_DIR"
    while [ "$d" != "/" ]; do
      ls "$d/CLAUDE.md" "$d/CLAUDE.local.md" "$d/.claude/CLAUDE.md" 2>/dev/null
      find "$d/.claude/rules" -maxdepth 1 -name '*.md' 2>/dev/null
      d=$(dirname "$d")
    done
    # Nested CLAUDE.md files below the target root
    find "$PROJECT_DIR" -mindepth 2 -name 'CLAUDE.md' -not -path '*/node_modules/*' 2>/dev/null
    # Claude Code auto memory
    local am; am=$(find_auto_memory_dir)
    [ -n "$am" ] && find "$am" -name '*.md' 2>/dev/null
  } | sort -u
  set -e
}

audit_file() {
  local f="$1"
  local lines mod age_days flags=""
  lines=$(wc -l < "$f" | tr -d ' ')
  if stat -f '%m' "$f" >/dev/null 2>&1; then
    mod=$(stat -f '%m' "$f")                       # macOS
  else
    mod=$(stat -c '%Y' "$f")                       # Linux
  fi
  age_days=$(( ( $(date +%s) - mod ) / 86400 ))

  [ "$lines" -gt 200 ] && flags="$flags OVERSIZED(>200-lines)"
  [ "$age_days" -gt "$STALE_DAYS" ] && flags="$flags STALE(${age_days}d)"
  # Files with no date anywhere: nothing matching YYYY-MM-DD
  grep -Eq '[0-9]{4}-[0-9]{2}-[0-9]{2}' "$f" || flags="$flags UNDATED"
  # Hedged/speculative language the agent may later treat as fact
  local spec
  spec=$(grep -inE '(probably|might be|i think|assume|seems to|likely)' "$f" | head -5 || true)
  [ -n "$spec" ] && flags="$flags SPECULATIVE"

  echo "----------------------------------------------------------------------"
  echo "FILE: $f"
  echo "  lines: $lines | last modified: ${age_days}d ago | flags:${flags:- none}"
  if [ -n "$spec" ]; then
    echo "  SPECULATIVE LANGUAGE (review these lines):"
    echo "$spec" | sed 's/^/    /'
  fi
}

cmd_audit() {
  mkdir -p "$AUDIT_DIR"
  local report="$AUDIT_DIR/audit-$TARGET_NAME-$(date +%Y%m%d-%H%M%S).txt"
  {
    echo "CLAUDE MEMORY AUDIT — $(date)"
    echo "Target: $PROJECT_DIR"
    local am_dir; am_dir=$(find_auto_memory_dir)
    echo "Auto memory dir: ${am_dir:-none (no auto-memory for this target)}"
    echo ""
    local any=0
    while IFS= read -r f; do
      [ -f "$f" ] || continue
      any=1
      audit_file "$f"
    done < <(list_memory_files)
    # Use a full if — the `[ ... ] && echo` idiom returns non-zero when files
    # ARE found (any=1), and as the last statement in this pipefail pipe under
    # `set -e` that aborts the script right before "Report saved" and makes the
    # batch wrapper report a false "(failed)".
    if [ "$any" -eq 0 ]; then echo "No memory files found."; fi
  } | tee "$report"
  echo ""
  echo "Report saved: $report"
}

cmd_backup() {
  local am; am=$(find_auto_memory_dir)
  [ -z "$am" ] && { echo "No auto memory directory found for $PROJECT_DIR."; exit 1; }
  mkdir -p "$AUDIT_DIR"
  local tarball="$AUDIT_DIR/auto-memory-$TARGET_NAME-$(date +%Y%m%d-%H%M%S).tar.gz"
  tar -czf "$tarball" -C "$(dirname "$am")" "$(basename "$am")"
  echo "Auto memory backed up to: $tarball"
}

cmd_reset() {
  local am; am=$(find_auto_memory_dir)
  [ -z "$am" ] && { echo "No auto memory directory found for $PROJECT_DIR."; exit 1; }
  cmd_backup
  read -r -p "Delete contents of $am ? [y/N] " ans
  if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
    rm -rf "${am:?}"/*
    echo "Auto memory cleared. It will rebuild from scratch (or disable it:"
    echo "  CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude )"
  else
    echo "Aborted. Backup kept."
  fi
}

cmd_inject() {
  local target="$PROJECT_DIR/CLAUDE.md"
  local marker="## Verification-first policy (anti-confabulation)"
  if [ -f "$target" ] && grep -qF "$marker" "$target"; then
    echo "Policy already present in $target"; return
  fi
  cat >> "$target" <<'EOF'

## Verification-first policy (anti-confabulation)
- Never answer questions about system state, code behavior, or configuration
  from memory or prior notes. Run the relevant command, read the actual file,
  or execute the diagnostic first, then answer citing that fresh output.
- Treat memory notes as hypotheses, not facts. Re-verify before relying
  on them. If verification is impossible, say so explicitly.
- Data retrieved via MCP tools reflects a point in time - re-fetch rather
  than answering from a remembered result.
- When recording notes to memory, include a date and how the fact was
  verified, e.g. "(verified 2026-07-11 via `npm test`)".

Example of correct behavior:
User: "Why is the build failing?"
Correct: run the build, read the error output, then diagnose from that output.
Incorrect: answer from a memory note about a past build failure.
EOF
  echo "Verification-first policy appended to: $target"
}

cmd_test() {
  local prompts_dir="$AUDIT_DIR/prompts"
  local out_dir="$AUDIT_DIR/results/$TARGET_NAME-$(date +%Y%m%d-%H%M%S)"
  [ -d "$prompts_dir" ] || { echo "Put one prompt per .txt file in $prompts_dir first."; exit 1; }
  command -v claude >/dev/null || { echo "claude CLI not found in PATH."; exit 1; }
  mkdir -p "$out_dir"
  for p in "$prompts_dir"/*.txt; do
    [ -f "$p" ] || continue
    local name; name=$(basename "$p" .txt)
    echo "Running prompt: $name"
    (cd "$PROJECT_DIR" && claude -p "$(cat "$p")" > "$out_dir/$name.out" 2>&1) || true
    # Simple confabulation smell-test: answer with no verification trace
    if ! grep -qiE '(ran|executed|output|checked|verified|read the file)' "$out_dir/$name.out"; then
      echo "  WARNING: no verification language detected — review $out_dir/$name.out"
    fi
  done
  echo "Results in: $out_dir  (diff against a previous run to compare)"
}

case "${1:-}" in
  audit)  cmd_audit ;;
  backup) cmd_backup ;;
  reset)  cmd_reset ;;
  inject) cmd_inject ;;
  test)   cmd_test ;;
  *) grep '^#' "$0" | head -22; exit 1 ;;
esac
