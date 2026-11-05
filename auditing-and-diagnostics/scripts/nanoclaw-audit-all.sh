#!/usr/bin/env bash
# nanoclaw-audit-all.sh — run claude-memory-audit.sh across every NanoClaw agent group.
# Run on the HOST (not inside a container), where the group folders live.
#
# Usage:
#   GROUPS_DIR=/path/to/nanoclaw/groups REPORT_DIR=/var/lib/nanoclaw-audit \
#     ./nanoclaw-audit-all.sh audit
#   GROUPS_DIR=... REPORT_DIR=... ./nanoclaw-audit-all.sh inject
#
# Environment:
#   GROUPS_DIR   The nanoclaw groups/ directory (one folder per agent group).
#   REPORT_DIR   Host-only directory for reports and the summary. REQUIRED here:
#                never write audit output inside group folders, because those
#                are mounted into agent containers and would be read back into
#                agent context (a new confabulation loop).

set -euo pipefail

GROUPS_DIR="${GROUPS_DIR:?Set GROUPS_DIR to your NanoClaw groups directory}"
REPORT_DIR="${REPORT_DIR:?Set REPORT_DIR to a host-only path, e.g. /var/lib/nanoclaw-audit}"
ACTION="${1:-audit}"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/claude-memory-audit.sh"
SUMMARY="$REPORT_DIR/audit-summary-$(date +%Y%m%d-%H%M%S).txt"

[ -f "$SCRIPT" ] || { echo "claude-memory-audit.sh not found next to this script"; exit 1; }
mkdir -p "$REPORT_DIR"

echo "NanoClaw memory audit — $(date)" | tee "$SUMMARY"

# Audit the shared/global group first if it exists — a wrong fact there
# contaminates every agent that loads it.
ORDERED_GROUPS=()
[ -d "$GROUPS_DIR/global" ] && ORDERED_GROUPS+=("$GROUPS_DIR/global/")
for g in "$GROUPS_DIR"/*/; do
  [ "$g" = "$GROUPS_DIR/global/" ] && continue
  ORDERED_GROUPS+=("$g")
done

for group in "${ORDERED_GROUPS[@]}"; do
  [ -d "$group" ] || continue
  name=$(basename "$group")
  echo "" | tee -a "$SUMMARY"
  echo "=== AGENT GROUP: $name ===" | tee -a "$SUMMARY"
  REPORT_DIR="$REPORT_DIR" bash "$SCRIPT" "$ACTION" "$group" 2>&1 | tee -a "$SUMMARY" || \
    echo "  (failed for $name — check manually)" | tee -a "$SUMMARY"
done

echo "" | tee -a "$SUMMARY"
echo "Summary written to: $SUMMARY"

# Snapshot memory state so future diffs show what agents wrote
if command -v git >/dev/null && [ -d "$GROUPS_DIR/.git" ]; then
  git -C "$GROUPS_DIR" add -A >/dev/null 2>&1 || true
  git -C "$GROUPS_DIR" commit -qm "memory audit snapshot $(date +%F)" >/dev/null 2>&1 || true
fi
