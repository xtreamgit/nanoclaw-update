---
type: Plan
title: Sandbox catch-up from live 2.0.64 to upstream 2026.10.1-rc.2
description: How this clone will absorb Saul's live customizations onto current upstream without touching the running Mac install or the GCE VM.
status: draft
created: 2026-11-05
sources:
  - resource: ../brief.md
    title: Context for this Cursor project
---

# Sandbox catch-up

This clone is already upstream NanoClaw **2026.10.1-rc.2**. The live Mac install is **2.0.64** on `saul-asdeployed`, plus whatever Saul changed after that. The catch-up is not a merge into the live folder. It is a read of that delta, then a hand replay onto this newer tree.

Standing rules are in [the brief](../brief.md).

## What I will do

1. Read the live repo only. Record its branch, HEAD, version, and whether the worktree is clean. List commits and changed paths on `saul-asdeployed` that are not in the 2.0.64 upstream base. Do not print secret file contents.
2. Measure the upstream gap from that 2.0.64 commit to this clone's `main` (`79deb707`, tracking `upstream/main`).
3. Sort the live delta into three buckets:
   - **Replay** — Saul behavior that still has to exist on 2026.10.1-rc.2.
   - **Dropped** — local changes upstream already replaced.
   - **Excluded** — `data/`, `.env`, `CLAUDE.local.md`, OneCLI, and anything that would turn Telegram on. Those stay on the Mac.
4. Write that inventory next to this plan. Product edits, if the replay set is small and unambiguous, go on a new branch in this clone only.
5. Stop and ask before a large or ambiguous replay, and before anything is promoted to the Mac or to `nanoclaw-vm`.

## What I will not do

* Edit, merge into, or restart `/Users/hd/github.com/xtreamgit/claudecode/AGENT-Installs/nanoclaw`.
* Copy `data/`, `.env`, `CLAUDE.local.md`, or OneCLI into this clone.
* Enable the live Mac Telegram bot on this tree. The Mac still owns that bot. The separate trial bot is in [saul2.md](saul2.md).
* Auto-merge into live, or change `nanoclaw-vm`.
* Treat a push to `https://github.com/xtreamgit/nanoclaw-update` as a promotion onto the live Mac. The remote is the public source shelf. `.env`, the OneCLI vault, `groups/`, and `data/` stay off it.

## Test VM

`nanoclaw-update-vm` is running in `dvlm-develom-ai` / `us-central1-a` (e2-standard-4, Debian 12, 100 GB, no external IP, `10.1.0.3`, label `env=test`). IAP SSH works. `nanoclaw-vm` (`10.1.0.2`) was not changed. Delete `nanoclaw-vm` only after this tree has been tested.

The VM has a checkout of `https://github.com/xtreamgit/nanoclaw-update` at `70a06b93`, as user `nanoclaw`, in `/home/nanoclaw/nanoclaw-update`. Docker 29.9.3, Node 22.23.4, and pnpm 10.34.5 are installed. `bash setup.sh` finished with `STATUS: success` (`better-sqlite3` loads). `pnpm run build` produced `dist/index.js`. The agent image is `nanoclaw-agent-v2-88663bb9:latest`.

The OneCLI vault was copied from the Mac by volume (`onecli_app-data`, `onecli_pgdata`) plus `~/.onecli`, uploaded to `gs://dvlm-develom-ai-nanoclaw-staging/onecli-2026-11-05/` (7-day delete), and restored on this VM only. The Mac gateway was stopped for the archive and is back on `1.41.0`. The VM gateway is the same version and answers on `127.0.0.1:10254`. Secret count 21 and agent count 35 match the Mac. The copy is pinned to `1.41.0` so Compose cannot float to `latest`. It was not upgraded to the skill pin `1.45.0`; that upgrade changes which agents receive which secrets, and the current host code can talk to a pre-grants gateway. Saul's groups and session databases were copied onto the VM later. Recurring tasks stayed paused, and the host is running as the accepted Saul2 install. Telegram there is `@saul2_bot`, not the live Mac bot. Operation is in [saul2.md](saul2.md). `.env`, the OneCLI volumes, `groups/`, and `data/` are not in git.

## Done for this pass

The inventory is [inventory.md](inventory.md). The chosen slice, the anti-confabulation stack, is installed in this clone. The other replay items, including the Docker socket-probe, are still waiting. Nothing was copied from `groups/`, and the live Mac install was not modified.

## Human gate

`hector@develom.com` reviews before any result leaves this clone for the Mac install or `nanoclaw-vm`.
