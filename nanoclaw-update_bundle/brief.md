---
type: Brief
title: Context for this Cursor project
description: What this nanoclaw-update folder is, what it must not touch, and where the accepted Saul2 install runs.
status: current
created: 2026-11-05
---

# Context for this Cursor project

This window is a **sandbox**. It is not the live NanoClaw. Another Cursor chat on the live repo planned a GCE move and asked to follow upstream without editing the running install.

## Three copies (do not mix them)

| Role | Where | What it is |
|---|---|---|
| **Live Saul** | `/Users/hd/github.com/xtreamgit/claudecode/AGENT-Installs/nanoclaw` on the Mac | Version **2.0.64**, branch `saul-asdeployed`. Still the live bot. |
| **Workshop** | This folder, and https://github.com/xtreamgit/nanoclaw-update | Version **2026.10.1-rc.2**. Source shelf. Do not put secrets here. |
| **Saul2** | GCP `nanoclaw-update-vm` in `dvlm-develom-ai`, zone `us-central1-a` | Accepted update install. Telegram bot `@saul2_bot`. |

`nanoclaw-vm` (`10.1.0.2`) is the older practice machine. Leave it alone until Hector says to delete it.

## Rules

* Do not edit, merge into, or restart the live Mac folder.
* Do not copy the live Telegram token, `TASK_INJECT_SECRET`, or other secrets into the public repo.
* Do not point the live bot at the VM. Saul2 uses its own bot.
* Do not promote this VM over the Mac until Hector asks. The trial week is the current use.

## Saul2 (accepted 2026-11-07)

Hector accepted this install after the warm reply test: Saul2 answered in 2.4 seconds, and the live Saul answered in 8 seconds. OneCLI on the VM has the same 12 connections as the live gateway. Recurring tasks stay paused. How to start the VM and open Telegram or the console is in [plan/saul2.md](plan/saul2.md).

## Operator

`hector@develom.com`. A later cutover, either keeping the Mac live or moving the real bot to this VM, waits for him.
