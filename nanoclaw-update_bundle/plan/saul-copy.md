---
type: Plan
title: Copy Saul onto the practice VM
description: Read-only copy of agent memory, CLAUDE files, and session databases from the live Mac onto nanoclaw-update-vm.
status: current
created: 2026-11-06
sources:
  - resource: catch-up.md
    title: Sandbox catch-up plan
---

# Copy Saul onto the practice VM

The practice host on `nanoclaw-update-vm` already answered a CLI turn. This copy brings the live agents across so that host has Saul's groups, memory, and session history. The live Mac install is only read. Nothing there is edited, stopped, or restarted.

## What is copied

From `/Users/hd/github.com/xtreamgit/claudecode/AGENT-Installs/nanoclaw`, read with SQLite's online backup so the running Mac host is not interrupted:

* `data/v2.db`, about 30 MB. It holds the 38 agent groups, 36 registered sessions, wirings, users, roles, and container configs. The practice host then applies migrations 17 through 25.
* `data/v2-sessions/<agent-group>/<session>/inbound.db` and `outbound.db`. 39 pairs, about 156 MB and 46 MB. Backup files (`inbound.db.bak`, `inbound.db.pre-vacuum-*`) stay behind.
* For each group folder: `CLAUDE.md`, `CLAUDE.local.md`, and `conversations/` when those paths are regular files or directories. Saul is `ag-1777520861575-n3h33w`. `CLAUDE.local.md` is the legacy memory. The new `groups/<folder>/memory/` tree does not exist on the Mac.

Archives go straight to `nanoclaw-update-vm` over IAP, are checked against their checksums, and are removed from `/tmp` after restore. They are not committed and are not left in a bucket.

## What is not copied

* The live process, launchd job, OneCLI on the Mac, and `nanoclaw-vm`.
* Telegram tokens. The practice `.env` keeps `ONECLI_URL`, `NANOCLAW_GATEWAY_PROVIDER=onecli`, and `TZ`.
* `node_modules`, virtualenvs, `.pnpm-store`, `groups/*/.secrets`, and per-agent credential files.
* The operator Claude Code notes under `~/.claude/projects/`. Those are not group memory.

## On the practice VM, before the host starts again

1. Stop `nanoclaw.service` and move the current `data/` aside. That keeps the empty CLI test.
2. Restore the backup. Rewrite `/Users/hd` to `/home/nanoclaw` in `container_configs.additional_mounts`. Clear image tags that name the Mac install slug so groups use the image already built here.
3. Pause pending recurring tasks in every restored inbound database. The last count on the Mac was 37. Confirm zero remain pending.
4. Put the upgrade marker back, start `nanoclaw.service`, and check `ncl groups list` for `saul`.

Do not send Saul a chat in this procedure. A turn would use the live vault. The later memory organization is recorded in [memory-migration.md](memory-migration.md).

## Human gate

`hector@develom.com` reviews before anything from this VM is promoted to the Mac install or to `nanoclaw-vm`. He accepted the running VM as the Saul2 trial install on 2026-11-07. Start and open it with [saul2.md](saul2.md).
