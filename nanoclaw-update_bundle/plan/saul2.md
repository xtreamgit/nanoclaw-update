---
type: Procedure
title: Bring up and open Saul2
description: Start the accepted NanoClaw update on nanoclaw-update-vm and open Saul2 in Telegram and in the OneCLI console.
status: current
created: 2026-11-07
sources:
  - resource: onecli-connections.md
    title: Check OneCLI connections on the practice VM
---

# Bring up and open Saul2

Saul2 is the accepted NanoClaw update on `nanoclaw-update-vm`. Hector accepted it on 2026-11-07 after a warm Telegram reply of 2.4 seconds, against 8 seconds for the live Saul on the Mac. The same 12 OneCLI connections are present. This is the install to use for the trial week.

The live Mac install stays the live Saul, and it still owns the original Telegram bot. `nanoclaw-vm` stays as it is. Do not copy the live bot token onto this VM, and do not resume recurring tasks unless Hector asks.

## What a clone gets

The git repo contains the host code that this VM runs: the OneCLI provider registered in `src/gateway-providers/installed.ts`, the Telegram adapter registered in `src/channels/index.ts`, and these notes. It does not contain `.env`, the bot token, the OneCLI vault, `groups/`, or `data/`.

After a clone, the new machine still has to be configured before it will answer:

1. Run OneCLI locally and set `ONECLI_URL=http://127.0.0.1:10254` and `NANOCLAW_GATEWAY_PROVIDER=onecli` in `.env`.
2. Put only the new bot's token in `TELEGRAM_BOT_TOKEN`. Do not use the live Mac bot's token.
3. Restore or create `data/` and `groups/` for the agents that should exist there. Those trees are not in the repo.
4. `pnpm install --frozen-lockfile`, `pnpm run build`, then start the host.

A clone without those steps builds, and it does not come up as Saul2.

## What is running

| Piece | Where |
| --- | --- |
| Practice VM | `nanoclaw-update-vm`, project `dvlm-develom-ai`, zone `us-central1-a`, address `10.1.0.3` |
| Host | `nanoclaw.service` in `/home/nanoclaw/nanoclaw-update`, package `2026.10.1-rc.2` |
| Gateway | OneCLI `1.41.0` on the VM, port `10254` |
| Telegram | `@saul2_bot`, https://t.me/saul2_bot, wired to Saul |
| Code shelf | https://github.com/xtreamgit/nanoclaw-update at `70a06b93`, plus the VM-only gateway and Telegram adapter |

Run every `gcloud` command from the Mac. A prompt that already says `nanoclaw-update-vm` is inside the machine, and `gcloud` there cannot see the instance.

## Start it

If the VM is stopped:

```bash
gcloud compute instances start nanoclaw-update-vm \
  --project=dvlm-develom-ai \
  --zone=us-central1-a
```

Docker, OneCLI, and `nanoclaw.service` are enabled, so they come back with the VM. Confirm from the Mac:

```bash
gcloud compute ssh nanoclaw-update-vm \
  --project=dvlm-develom-ai \
  --zone=us-central1-a \
  --tunnel-through-iap \
  --command='systemctl is-active nanoclaw; sudo docker ps --filter name=onecli --format "{{.Names}} {{.Status}}"'
```

`nanoclaw` should be `active`. The `onecli` container should be up. Leave the VM running for the whole trial, or Telegram cannot reach Saul2.

To stop paying for compute when the trial is idle:

```bash
gcloud compute instances stop nanoclaw-update-vm \
  --project=dvlm-develom-ai \
  --zone=us-central1-a
```

That keeps the disk. It does not delete the VM, and it does not touch `nanoclaw-vm`.

## Open Saul2 in Telegram

On a phone, open https://t.me/saul2_bot and send a normal message. Hector's chat is already paired to Saul. Robert Hughes can message that same bot from his own Telegram account. His chat was already wired to Saul.

The original Saul bot on the Mac is a different bot. Messages sent there still reach the live Mac.

## Open the OneCLI console

The Mac already uses port `10254` for the live gateway. From a Mac terminal, forward a different local port and leave the window open:

```bash
gcloud compute ssh nanoclaw-update-vm \
  --project=dvlm-develom-ai \
  --zone=us-central1-a \
  --tunnel-through-iap \
  -- -N -L 18080:127.0.0.1:10254
```

Then browse `http://127.0.0.1:18080`.

The remote port is `10254`. A forward to `20254` makes the browser show `ERR_CONNECTION_RESET`, because nothing listens there. The NumPy line `gcloud` prints is a speed warning, not a failure.

The live console stays at `http://127.0.0.1:10254`. The connection check is in [onecli-connections.md](onecli-connections.md).

## Timing accepted on 2026-11-07

Both bots were sent `pong` twice. The first reply includes starting the container. The second reply is the warm time.

| Bot | First reply | Second reply |
| --- | --- | --- |
| Live Saul, Mac | 73 seconds | 8 seconds |
| Saul2, practice VM | 161.8 seconds | 2.4 seconds |

The warm Saul2 reply was a little over three times faster. The live reply stamp has no fractions of a second.
