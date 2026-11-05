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
* Enable Telegram. The Mac still owns the bot.
* Auto-merge into live, or change the GCE VM.
* Treat `https://github.com/xtreamgit/nanoclaw-update` as a promotion target. It is a public mirror of this sandbox's `main`. The brief still says that repo does not exist; that line is stale.

## Done for this pass

The inventory is [inventory.md](inventory.md). The chosen slice, the anti-confabulation stack, is installed in this clone. The other replay items, including the Docker socket-probe, are still waiting. Nothing was copied from `groups/`, and the live Mac install was not modified.

## Human gate

`hector@develom.com` reviews before any result leaves this clone for the Mac install or `nanoclaw-vm`.
