---
type: Procedure
title: Check OneCLI connections on the practice VM
description: Connect to nanoclaw-update-vm and compare its OneCLI app connections with the live Mac gateway.
status: current
created: 2026-11-07
sources:
  - resource: saul-copy.md
    title: Copy Saul onto the practice VM
---

# Check OneCLI connections on the practice VM

Run this from the Mac. The practice gateway is OneCLI on `nanoclaw-update-vm`. The live gateway is the Mac container named `onecli`, image `ghcr.io/onecli/onecli:1.41.0`, on `127.0.0.1:10254`. Leave both running. Do not change the Mac CLI setting `api-host`. It stays `https://api.onecli.sh`.

`onecli-vogel-dev` on port `11254` is a different gateway. Do not use it for this check.

## Connect to the VM

```bash
gcloud compute ssh nanoclaw-update-vm \
  --project=dvlm-develom-ai \
  --zone=us-central1-a \
  --tunnel-through-iap
```

That command has to start on the Mac. From a prompt that already says `nanoclaw-update-vm`, you are on the machine.

The OneCLI CLI on the VM belongs to the `nanoclaw` user:

```bash
sudo -u nanoclaw bash -lc 'onecli config get api-host'
```

The value is `http://127.0.0.1:10254`. Leave it there. `sudo onecli` fails because `onecli` is not on root's path.

## Open the practice console

The Mac already uses port `10254` for the live gateway. Forward a different local port and leave this SSH session open:

```bash
gcloud compute ssh nanoclaw-update-vm \
  --project=dvlm-develom-ai \
  --zone=us-central1-a \
  --tunnel-through-iap \
  -- -L 18080:127.0.0.1:10254
```

Open `http://127.0.0.1:18080`. That is the practice console. The live console stays at `http://127.0.0.1:10254`.

The remote port in that command is `10254`. Forwarding `20254` instead makes the browser show `ERR_CONNECTION_RESET`. Bring-up for the accepted install is in [saul2.md](saul2.md).

## Compare connections

On the VM, as `nanoclaw`:

```bash
sudo -u nanoclaw bash -lc 'onecli counts'
sudo -u nanoclaw bash -lc 'onecli apps connections list'
```

On the Mac, in a second terminal. `ONECLI_API_HOST` applies to that one command and does not save the CLI setting:

```bash
ONECLI_API_HOST=http://127.0.0.1:10254 onecli counts
ONECLI_API_HOST=http://127.0.0.1:10254 onecli apps connections list
onecli config get api-host
```

The last command must still print `https://api.onecli.sh`. Do not run `onecli config set`. Do not run `onecli auth api-key`, and do not copy secret values into chat or into this repo.

Match rows on `id`, `provider`, `label`, and `status`.

## Result on 2026-11-07

Both gateways have the same 12 connections, all `connected`, label `hector@develom.com`:

| Provider | Connection id |
| --- | --- |
| gmail | `10e375ed-2920-4b66-865a-b7e8b64c9d1a` |
| google-analytics | `612a75bd-b6f4-4bc4-b6af-acb0e62748b9` |
| google-calendar | `870a9961-465f-4554-a3a8-0da42074d07a` |
| google-chat | `1ecf604e-662e-4893-8a68-f90e4ca9ea53` |
| google-contacts | `799f4c13-10b7-400f-91c6-8839da2d3c2e` |
| google-docs | `47c8ddc8-640f-4f89-bfd3-5d1f83eb835d` |
| google-drive | `5215b08d-bdba-4c18-bf80-7cf5efe4344b` |
| google-meet | `e6d62d1c-ad59-4384-8f66-fe85d27c096b` |
| google-sheets | `40b3a2c8-5e3a-4a17-870e-e1f106b6995e` |
| google-slides | `cc815be8-2977-40ac-917d-e9dd4e00db2f` |
| vercel | `bd9bdad2-3ead-4afb-8771-d8dbee1cf99c` |
| youtube | `2d35da22-8fc5-4d66-8cba-4898d4eaeaa6` |

`onecli counts` matches on apps `12`, llms `1`, and secrets `20`. Agents differ: live `35`, practice `42`. The practice host added agents after the vault copy. The connection rows themselves are the same.
