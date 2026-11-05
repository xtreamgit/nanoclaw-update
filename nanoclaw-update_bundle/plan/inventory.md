---
type: Inventory
title: Live delta versus upstream main, measured 2026-11-05
description: Read-only count of saul-asdeployed against v2.0.64 and this clone, and which of that delta may be replayed here.
status: draft
created: 2026-11-05
sources:
  - resource: catch-up.md
    title: Sandbox catch-up plan
  - resource: /Users/hd/github.com/xtreamgit/claudecode/AGENT-Installs/nanoclaw/CUSTOMIZATIONS.md
    title: Develom fork customization inventory, last reviewed 2026-08-17
---

# Live delta versus upstream main

Measured read-only on 2026-11-05. The live folder was not modified.

| | Live Mac install | This clone |
|---|---|---|
| Path | `.../AGENT-Installs/nanoclaw` | `.../AGENT-Installs/nanoclaw-update` |
| Branch | `saul-asdeployed` | `main` |
| HEAD | `f285338b` (2026-11-04, workspace backup) | `79deb707` (upstream `main`) |
| Package version | 2.0.64 | 2026.10.1-rc.2 (`v2026.10.1-rc.2-30-g79deb707`) |
| Worktree | Dirty. Uncommitted edits are agent notes, a deck, and `nanoclaw-bundle/gce-deployment/` | Clean except this untracked bundle |

Shared history ends at `78bb6cb0` (2026-05-17, "chore: bump version to 2.0.64"), which is the parent of tag `v2.0.64`. The tag itself is two changelog commits the live branch never took.

| Direction | Commits |
|---|---|
| Upstream `main` not in `saul-asdeployed` | **1425** |
| `saul-asdeployed` not in upstream `main` | **55** |

The live repo's own `CUSTOMIZATIONS.md` (reviewed 2026-08-17) says the same thing in older numbers: fork point `78bb6cb0`, and for a jump this size use `/migrate-nanoclaw` rather than one merge. That file is the map. It is stale by six commits. It stays in the live repo and was not copied here.

## Six commits after the 2026-08-17 inventory

| Commit | What it is |
|---|---|
| `f57aceb1` | As-deployed snapshot, 2026-08-17 |
| `197ecb12` | Product fix: socket-probe Docker so host starvation is not reported as "Docker down" |
| `c302cfbd`, `aedcdc1a`, `ad085ff8`, `f285338b` | Agent workspace backups through 2026-11-04 |

## Three buckets

### Replay later, by hand, and only the behavior

These are the fork's product changes. Current `main` does not contain the old module names (`alerts`, `routing-guard`, `token-tracking`, `task-inject`) or the native channel files (`telegram.ts`, `whatsapp.ts`, `signal.ts`, `github.ts`). Upstream now installs channels with `/add-*` skills. A file copy from the May tree onto this tree will not apply.

From CUSTOMIZATIONS.md §A and §B, the behaviors to re-decide are:

* Anti-confabulation stack: ground-truth selfcheck, protected MCP/config lockdown, grounding snapshot, `nanoclaw-doctor`, `/fact-check`.
* Host hardening: hook-guard sweep, Docker readiness retry, agent-name guard, idle-container reaping, the 2026-11 socket-probe (`197ecb12`).
* Ops modules: alerts, routing-guard, token-tracking, task-inject, startup commands, watchdog, status CLI.
* Harness edits inside the agent runner: per-sender rate cap, compaction checkpoint, routing that blocks the SDK send/team tools.

Each one needs a fresh read of the current file before any edit. Registration points called out in that doc (`src/index.ts`, `src/modules/index.ts`, `src/db/migrations/index.ts`, `src/channels/index.ts`) have been rewritten.

### Dropped for this catch-up

* The two `v2.0.64` changelog commits. They are already ancestors of this `main`.
* Native channel adapters as source files. Telegram, WhatsApp, Signal, and GitHub are skills now. Telegram stays off in this clone anyway.
* Install-specific instruction edits in the live `CLAUDE.md` files. This clone keeps upstream's instructions until a behavior is deliberately ported.

### Excluded — do not copy, do not commit, do not push

The three-dot diff is **7,874 files**. **7,710** of them are under `groups/`. That tree is agent workspace state: notes, drafts, client documents, and credential files. Also excluded:

* `data/`, `.env`, `CLAUDE.local.md`, OneCLI
* `inbound.db` and `outbound.db` (tracked on the live branch, empty)
* `scripts/__pycache__/migadu-passwords.cpython-313.pyc`
* `usage_report.csv`, avatars, the agent spreadsheet, and the uncommitted GCE notes

`https://github.com/xtreamgit/nanoclaw-update` is public. Pushing `groups/` would publish that material. Nothing from the live worktree has been copied here.

## Installed in this clone (2026-11-05)

The anti-confabulation stack, chosen because memory correctness comes before the startup fix. Adapted onto current `main`, not copied as a May-era patch.

| Layer | What landed |
|---|---|
| 1 | `scripts/nanoclaw-doctor.py` (read-only) and `container/skills/ground-truth/selfcheck.mjs` |
| 2 | `container/skills/ground-truth/` — `instructions.md` is inlined into the project doc for every group whose skill selection is `all` (the default) |
| 3 | `src/modules/self-mod/protected-config.ts`, enforced in `dispatch`, `validateAddMcpServer`, and `applyAddMcpServer` before a card or a write. `email-imap` is blocked by name. Raw credential env/header values are blocked. `gateway-managed` and `onecli-managed` are allowed on other servers. Host `ncl` is exempt. |
| 4 | `scripts/agent-grounding.py` — snapshot, and `reset` clears `continuation:*` |
| Operator | `.claude/skills/fact-check/SKILL.md`, `docs/instructions.md`, `docs/anti-confabulation-design-qa.md`, `auditing-and-diagnostics/` |

`pnpm exec vitest run` on the Layer 3 tests: 3 files, 47 tests, passed.

This clone is not the running Mac host. The skill mount is `container/skills` → `/app/skills`, so a container started from this tree sees `selfcheck.mjs` without an image rebuild. The live install and `nanoclaw-vm` are unchanged.

## Still waiting

The rest of the replay list (alerts, routing-guard, token-tracking, task-inject, harness edits, and `197ecb12`). `groups/` stays excluded.
