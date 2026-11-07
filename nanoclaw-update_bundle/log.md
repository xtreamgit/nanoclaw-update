# Log

## 2026-11-07 — Microsoft 365 is outside this OneCLI

Hector added the caveat to [plan/local-onecli.md](plan/local-onecli.md). The local vault has Google, Vercel, and YouTube only. The Community catalog on this VM has no Outlook or other Microsoft app. OneCLI documents those apps as Cloud managed-OAuth or Enterprise with Develom's own Entra app. The note records a loopback Graph broker as the clean path on this image.

## 2026-11-07 — local OneCLI is the client pattern

Recorded that `nanoclaw-update-vm` runs OneCLI `1.41.0` itself and that every agent on that install uses `http://127.0.0.1:10254`, not `https://api.onecli.sh`. One gateway per client install, with a separate agent identity and grants inside it. The Mac CLI `api-host` is still the website. Note: [plan/local-onecli.md](plan/local-onecli.md).

## 2026-11-07 — Saul2 accepted

Hector accepted the NanoClaw update on `nanoclaw-update-vm` as the Saul2 install. A warm `pong` took 2.4 seconds there and 8 seconds on the live Mac. The first replies, which included starting the container, were 161.8 seconds and 73 seconds. The practice OneCLI console is opened by forwarding Mac port `18080` to VM port `10254`. Procedure: [plan/saul2.md](plan/saul2.md). The live bot and `nanoclaw-vm` were not changed.

## 2026-11-07 — OneCLI connections match

Compared app connections on the live Mac gateway (`onecli` at `127.0.0.1:10254`) with the practice gateway on `nanoclaw-update-vm`. The same 12 connections are present, with the same ids and status `connected`. Counts match for apps, llms, and secrets. The practice vault has 42 agents and the live vault has 35. The Mac CLI `api-host` is still `https://api.onecli.sh`. Procedure: [plan/onecli-connections.md](plan/onecli-connections.md).

## 2026-11-06 — agent memory checks

On `nanoclaw-update-vm`, each group with a folder was given one CLI turn asking for its name and one memory fact, with tools and outbound sends forbidden. 36 replied on the CLI only. No recurring task was left pending, and the CLI wiring was removed after each turn. `main` did not start: OneCLI returned 400 while registering `ag-17775232803N-972f71`. `robert` has no folder. The live Mac install and `nanoclaw-vm` were not changed.

## 2026-11-06 — memory organized on the practice VM

Stopped `nanoclaw.service` on `nanoclaw-update-vm` and moved each group's legacy `CLAUDE.local.md` into `instructions.prepend.md` plus `memory/`. Claude auto-memory notes were copied into `memory/notes/`. Originals remain in `.memory-migration-staging/`. No symlinks. Recurring tasks stayed paused, and no agent was woken. `robert` had no folder. The live Mac install and `nanoclaw-vm` were not changed. Report: [plan/memory-migration.md](plan/memory-migration.md).

## 2026-11-06 — Saul copy on the practice VM

Read the live Mac install and restored it onto `nanoclaw-update-vm` only. The copy is the central DB, 39 inbound/outbound pairs, each group's `CLAUDE.md` and `CLAUDE.local.md`, `conversations/`, and per-session `.claude-shared`. 13 mount paths were rewritten off `/Users/hd`, 6 Mac image tags were cleared, and 37 recurring tasks were paused. The host applied the newer migrations through `container-config-speed` and is running. No agent container was started. Telegram stayed off. The live Mac install and `nanoclaw-vm` were not changed. Procedure: [plan/saul-copy.md](plan/saul-copy.md).

## 2026-11-06 — network diagram

Saved [nanoclaw-update-vm-network.pdf](nanoclaw-update-vm-network.pdf): the practice VM on `develom-ai-vpc`, the Mac paths into it, and the pieces a future Kubernetes move has to replace. Measured from the project on this date. `nanoclaw-vm` was not changed.

## 2026-11-06 — CLI test answered

Created `test-agent` on the CLI channel only. The first turns failed because the container could not reach OneCLI on `127.0.0.1`. The VM gateway now listens on all local interfaces, still with no external IP. The agent then replied `pong`. Telegram stayed off. `nanoclaw-vm` was not changed.

## 2026-11-06 — practice host started

`nanoclaw-update-vm` host is running as `nanoclaw.service`. It selected the OneCLI gateway, opened an empty central DB, and `ncl groups list` returned no rows. Telegram is still absent. The first start stopped on the upgrade tripwire; it was stamped with `scripts/upgrade-state.ts set` after the manual bootstrap and then stayed up. `nanoclaw-vm` was not changed.

## 2026-11-05 — OneCLI vault on the test VM

Copied the Mac OneCLI volumes and `~/.onecli` through `gs://dvlm-develom-ai-nanoclaw-staging/onecli-2026-11-05/`. The Mac gateway is back on `1.41.0`. The practice VM gateway matches it: health ok, 21 secrets, 35 agents. Telegram was not copied. The OneCLI provider is registered on the VM checkout. The host is not started. `nanoclaw-vm` was not changed.

## 2026-11-05 — test VM bootstrap

Cloned `xtreamgit/nanoclaw-update` at `70a06b93` onto `nanoclaw-update-vm` (`/home/nanoclaw/nanoclaw-update`). Host TypeScript build and agent image `nanoclaw-agent-v2-88663bb9:latest` succeeded. Host service was not started. `nanoclaw-vm` was not changed.

## 2026-11-05 — test VM

Created `nanoclaw-update-vm` in `dvlm-develom-ai` (`us-central1-a`, `10.1.0.3`). `nanoclaw-vm` left running and unchanged.

## 2026-11-05 — anti-confabulation stack

Installed the four-layer stack in this clone: ground-truth skill, `nanoclaw-doctor`, credential lockdown on the current MCP approval paths, `agent-grounding.py`, `/fact-check`, and the memory-audit scripts. Live Mac install untouched. Layer 3 tests: 47 passed.

## 2026-11-05 — catch-up inventory

Read the live repo only. Recorded the result in [plan/inventory.md](plan/inventory.md): fork point `78bb6cb0`, 1,425 upstream commits not in `saul-asdeployed`, 55 live commits not in upstream, 7,710 of the diff files under `groups/`. No files were copied and no product code was changed.

## 2026-11-05 — catch-up plan

Added [plan/catch-up.md](plan/catch-up.md). This clone will inventory the live `saul-asdeployed` delta and the upstream gap from 2.0.64, then replay only a clear, safe set onto a branch here. The live Mac install and `nanoclaw-vm` stay untouched.

## 2026-11-05 — bundle created

Initialized a flat OKF v0.2 bundle in the nanoclaw-update clone and added [brief.md](brief.md) so a new Cursor chat on this folder has the live-vs-sandbox rules and GCE status from the parallel conversation on the live install.
