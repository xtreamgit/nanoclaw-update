---
type: Brief
title: Context for this Cursor project
description: What this nanoclaw-update folder is, what it must not touch, and where the live install and GCE work live.
status: current
created: 2026-11-05
---

# Context for this Cursor project

This window is a **sandbox**. It is not the live NanoClaw. Another Cursor chat on the live repo planned a GCE move and asked to follow upstream without editing the running install.

## Two folders (do not mix them)

| Role | Path | Git |
|---|---|---|
| **Live Mac install** | `/Users/hd/github.com/xtreamgit/claudecode/AGENT-Installs/nanoclaw` | fork `xtreamgit/nanoclaw`, branch `saul-asdeployed`, version **2.0.64** |
| **This update clone** | `/Users/hd/github.com/xtreamgit/claudecode/AGENT-Installs/nanoclaw-update` | `upstream` = `nanocoai/nanoclaw` `main`, version **2026.10.1-rc.2**; remote `fork` = `xtreamgit/nanoclaw` |

There is **no** GitHub repo named `xtreamgit/nanoclaw-update`. This folder is local only.

## Rules

* Do not edit, merge into, or restart the live folder.
* Do not copy `data/`, `.env`, `CLAUDE.local.md`, or OneCLI into this clone unless the operator asks.
* Do not turn on Telegram here (the Mac still owns the bot).
* First catch-up is about **1,425 commits** (May 2.0.64 → Oct 2026.10.x). Do it by hand here, then consider automation. Never auto-merge into live.

## Live install and GCE (status 2026-11-05)

Parallel test VM `nanoclaw-vm` in GCP project `dvlm-develom-ai` (us-central1-a, no external IP, IAP SSH). State restored from a **2026-11-04 ~10:22 PT** backup. `CLAUDE.local.md` files match the Mac; session DBs and two Saul auto-memory files on the Mac are newer. Telegram is off on the VM; recurring tasks are paused. CLI chat to test-agent works; `chat-saul.sh` on the VM talks to Saul without Telegram.

Full plan: live repo `nanoclaw-bundle/gce-deployment/plan.md` and `cursor-files/status.md`.

## Operator

`hector@develom.com`. Prefer a human gate before promoting anything from this clone to live or to the VM.
