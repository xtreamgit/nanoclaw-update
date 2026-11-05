# Auditing and Diagnostics — NanoClaw Agent Memory

A complete plan for auditing agent memory (CLAUDE.md files and related state)
in a NanoClaw installation, to detect and reduce confabulation: agents
answering from stale or speculative memory instead of verifying.

## Why this exists

NanoClaw agents carry knowledge across sessions through per-group `CLAUDE.md`
files, session transcripts, and (if enabled) Claude Code auto memory. Agents
write to their own memory, including guesses. In later sessions those guesses
load as trusted context, so speculation becomes "fact" and errors compound.
A restart does not fix this: memory files reload at every session start, and
resumed sessions restore the full prior transcript.

The fix is a maintenance loop: snapshot memory, audit it, prune flagged
entries, enforce verification-first behavior, and regression-test.

## Folder contents

```
auditing-and-diagnostics/
├── auditing-and-diagnostics.md      <- this file
└── scripts/
    ├── claude-memory-audit.sh       <- core audit/backup/reset/inject/test tool
    └── nanoclaw-audit-all.sh        <- wrapper: runs the core tool on every agent group
```

## What NanoClaw memory lives where

| Path | What it is | Audited? |
|---|---|---|
| `groups/<folder>/CLAUDE.md` | Per-agent-group memory/instructions. Mounted into that group's container. Primary confabulation surface. | Yes |
| `groups/global/CLAUDE.md` | Shared knowledge loaded by all groups (if present). Highest blast radius — audited first. | Yes |
| `CLAUDE.local.md` (anywhere) | v1 leftover personal instructions. Should not exist after v2 migration. | Yes (flagged) |
| `data/v2.db` | Central DB: agent groups, sessions, users, roles. | No (structured state, not hand-edited) |
| `data/v2-sessions/<id>/inbound.db`, `outbound.db` | Per-session message queues. | No |
| Session transcripts (JSONL, per session) | Full conversation history; restored when a session resumes. | No, but see "Session reset" below |

## One-time setup

### 1. Install the scripts

Copy this folder to your host (e.g. `/opt/auditing-and-diagnostics/`) and make
the scripts executable:

```bash
chmod +x /opt/auditing-and-diagnostics/scripts/*.sh
```

### 2. Create a host-only report directory

Audit output must NEVER be written inside `groups/` — group folders are
mounted into agent containers, so agents would read audit reports back into
their own context.

```bash
sudo mkdir -p /var/lib/nanoclaw-audit
sudo chown "$USER" /var/lib/nanoclaw-audit
```

### 3. Put groups/ under git (local, private)

Every audit then pairs with a diff showing exactly what each agent wrote.

```bash
cd /path/to/nanoclaw/groups
git init
printf 'attachments/\n*.db\n*.jsonl\n' > .gitignore
git add -A && git commit -m "baseline before audits"
```

Keep this repo local or in a private remote — group folders can contain
personal, conversation-derived data.

### 4. Inject the verification-first policy into every group

```bash
GROUPS_DIR=/path/to/nanoclaw/groups \
REPORT_DIR=/var/lib/nanoclaw-audit \
  /opt/auditing-and-diagnostics/scripts/nanoclaw-audit-all.sh inject
```

This appends an anti-confabulation section to each group's `CLAUDE.md`:
verify before answering, treat memory as hypotheses, re-fetch MCP data,
date-stamp new memory entries. It is idempotent (safe to run twice).

Then commit: `git -C /path/to/nanoclaw/groups add -A && git commit -m "inject verification-first policy"`

### 5. Capture regression prompts

Save 2-3 prompts that previously produced confabulated answers, one per file:

```bash
mkdir -p /var/lib/nanoclaw-audit/prompts
echo "Why is the build failing?" > /var/lib/nanoclaw-audit/prompts/build-status.txt
```

## Using the scripts

### Audit all agent groups

```bash
GROUPS_DIR=/path/to/nanoclaw/groups \
REPORT_DIR=/var/lib/nanoclaw-audit \
  /opt/auditing-and-diagnostics/scripts/nanoclaw-audit-all.sh audit
```

Produces a per-group report plus a combined summary in `$REPORT_DIR`.
The `global` group (if present) is audited first. Flags:

- `STALE(Nd)` — not modified in over 30 days (tune with `STALE_DAYS=60`)
- `UNDATED` — no YYYY-MM-DD date anywhere in the file
- `OVERSIZED` — over 200 lines (reduces instruction adherence)
- `SPECULATIVE` — hedged language ("probably", "I think", "might be") that a
  future session will read as fact; the flagged lines are printed

### Audit a single group

```bash
REPORT_DIR=/var/lib/nanoclaw-audit \
  /opt/auditing-and-diagnostics/scripts/claude-memory-audit.sh audit /path/to/nanoclaw/groups/sales-agent
```

### Other core-script commands (per target directory)

- `backup` — tarball the Claude Code auto-memory directory (if one exists)
- `reset`  — backup, then interactively clear auto memory. Manual only; never cron.
- `inject` — append the verification-first policy to that directory's CLAUDE.md
- `test`   — replay every prompt in `$REPORT_DIR/prompts/` via `claude -p` and
  warn when a response contains no verification language

### Session reset (the step a restart misses)

After pruning a polluted `CLAUDE.md`, also reset that group's session so the
old transcript is not resumed into a clean file. Use NanoClaw's `ncl` CLI (or
ask Claude Code in your fork: "reset the session for agent group X"). A cleaned
memory file plus a resumed polluted transcript equals immediate re-pollution.

## Cron jobs

Edit your crontab with `crontab -e` and add (adjust paths):

```cron
# ── NanoClaw memory auditing ─────────────────────────────────────────────
NCL_GROUPS=/path/to/nanoclaw/groups
NCL_REPORTS=/var/lib/nanoclaw-audit
NCL_SCRIPTS=/opt/auditing-and-diagnostics/scripts

# Daily 02:00 — git snapshot of what agents wrote (cheap)
0 2 * * * cd $NCL_GROUPS && git add -A && git commit -qm "daily snapshot $(date +\%F)" || true

# Weekly Monday 03:00 — full audit across all groups
0 3 * * 1 flock -n /tmp/ncl-audit.lock env GROUPS_DIR=$NCL_GROUPS REPORT_DIR=$NCL_REPORTS $NCL_SCRIPTS/nanoclaw-audit-all.sh audit >> /var/log/nanoclaw-audit.log 2>&1

# Weekly Monday 03:30 — email the latest summary if anything was flagged
30 3 * * 1 ls -t $NCL_REPORTS/audit-summary-*.txt | head -1 | xargs grep -lE 'STALE|UNDATED|OVERSIZED|SPECULATIVE' | xargs -r cat | mail -s "NanoClaw memory audit flags" you@example.com
```

Notes:

- `flock -n` prevents overlapping audit runs.
- `%` must be escaped as `\%` inside crontab entries.
- `mail` requires a configured MTA; alternatively pipe the summary to any
  notifier you use (Slack webhook, ntfy, or a NanoClaw channel — send it as a
  message, do not store it in a group folder).
- Some cron implementations do not support variables; if yours doesn't,
  write the full paths inline.

Verify cron is running the jobs:

```bash
grep nanoclaw /var/log/syslog        # or journalctl -u cron
ls -lt /var/lib/nanoclaw-audit | head
```

## Review rhythm

**Weekly (from the audit email/summary):**

1. Read the flags for `global` and your busiest shared groups first.
2. `git -C $NCL_GROUPS diff HEAD~7 -- '*/CLAUDE.md'` — what did agents write?
3. Note anything speculative that entered memory.

**Monthly:**

1. Prune flagged entries; add dates/verification notes to what remains.
2. Reset the sessions of any group whose memory you pruned.
3. Commit with a descriptive message, e.g. `pruned speculation from sales-agent`.
4. Re-run the regression test:
   `REPORT_DIR=/var/lib/nanoclaw-audit $NCL_SCRIPTS/claude-memory-audit.sh test $NCL_GROUPS/<group>`

**Never automate:** `reset` (memory deletion) stays manual so good facts are
not deleted along with bad ones.

## Design rules baked into this setup

1. The audit runs on the host, outside containers — agents must not audit or
   rewrite their own memory.
2. Reports live outside `groups/` — nothing an agent can mount reads back in.
3. Git is the snapshot layer — every change to agent memory is diffable and
   attributable to a date.
4. Deterministic scripts, human judgment — cron detects and reports; a human
   decides what to prune or reset.
5. Shared memory gets the tightest scrutiny — `groups/global/CLAUDE.md` and
   any agent shared across channels compound errors fastest.
