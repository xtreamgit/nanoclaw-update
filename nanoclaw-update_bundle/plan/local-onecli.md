---
type: Concept
title: Develom can host OneCLI for every client
description: The NanoClaw update VM runs its own OneCLI, and every agent on that install uses it instead of the OneCLI website.
status: current
created: 2026-11-07
sources:
  - resource: saul2.md
    title: Bring up and open Saul2
  - resource: onecli-connections.md
    title: Check OneCLI connections on the practice VM
---

# Develom can host OneCLI for every client

This is a major win for Develom. A client install can run its own OneCLI, and every agent on that install uses it. Those agents do not call the OneCLI website at `https://api.onecli.sh`. The vault, the app connections, and the grants stay on the client's machine.

`nanoclaw-update-vm` is the proof. Saul and the other agent groups there answer through a OneCLI container on that VM. On 2026-11-07 that gateway had the same 12 app connections as the live Mac gateway, all stored locally, and Saul2 answered Telegram from that vault.

## Microsoft 365 is not in this vault

Those 12 connections are Google (Gmail, Calendar, Chat, Contacts, Docs, Drive, Meet, Sheets, Slides, Analytics), Vercel, and YouTube. This OneCLI installation has no Microsoft connection. It does not reach Outlook, Microsoft Calendar, or any other Microsoft 365 application. Copying this vault onto a new client does not add them.

The running image is Community, `ghcr.io/onecli/onecli:1.41.0`. Its app catalog on 2026-11-07 listed 20 apps: Google, GitHub, GitLab, and Resend. Outlook Mail, Outlook Calendar, Microsoft Word, and OneNote were not among them.

OneCLI's own docs split Microsoft off from the image this VM runs. [App credentials](https://onecli.sh/docs/self-hosting/app-credentials) puts Outlook Mail, Outlook Calendar, Word, and OneNote in the Enterprise edition only (`onecli/slim`). [Self-hosting editions](https://onecli.sh/docs/self-hosting/overview) says Community has community apps with your own OAuth credentials, and Cloud has every app with OneCLI's managed OAuth. The cloud Connect button works because OneCLI's website owns the Microsoft app registration and the redirect. That client secret is not in the Community image, so a local gateway cannot complete Microsoft's login on OneCLI's behalf. On Enterprise, the documented path is still your own Entra app: set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`, and register the redirect `{APP_URL}/v1/apps/outlook-mail/callback`. One app covers mail, calendar, Word, and OneNote. The refresh token then stays in the local vault. It does not have to live at `api.onecli.sh`.

## A clean Microsoft path on this VM

Do not put a Microsoft secret in an agent container, in git, or in the public repo. Do not point these agents at `api.onecli.sh` just to borrow OneCLI's Microsoft app.

The path that matches this Community install:

1. In the Develom tenant, register a single-tenant Entra app. Prefer a certificate over a client secret. Grant application permissions for the mail and calendar reads that are actually needed, then admin-consent them. Limit the app to specific mailboxes with an Exchange application access policy.
2. Run a small Graph broker on the VM, bound to loopback, next to OneCLI. It holds the certificate, asks Microsoft for tokens, and calls `graph.microsoft.com`. Agents call the broker. They never see the certificate or the token.
3. Start with read. Mail send and calendar writes stay behind NanoClaw's existing approval gate.
4. Keep OneCLI as the gateway for the Google, Vercel, and YouTube connections it already has.

Buying OneCLI Enterprise and connecting Outlook through the local gateway is the other clean option. That still uses Develom's Entra app, and the tokens stay on the VM. It is a license choice, not a requirement that the mailbox traffic go through the OneCLI website.

## One gateway per client, many agents

NanoClaw does not put a OneCLI inside each agent container. It runs one gateway for the whole install. Each agent group then gets its own agent identity inside that gateway, with only the connections and secrets granted to it.

On this VM that is one Docker container, `onecli`, image `ghcr.io/onecli/onecli:1.41.0`, plus its Postgres container. The vault is the Docker volumes copied from the Mac. New clients get the same shape: one OneCLI on that client's host, and as many NanoClaw agents as that client needs, each with its own grants.

A new agent does not inherit every connection. Model credentials that NanoClaw recorded are attached when that agent starts. Gmail, Drive, Vercel, and the other app connections are attached only to the agents that should have them. The connection itself is stored once, in that client's vault.

## How this VM does it

The gateway listens on the VM at port `10254` (the API and console) and port `10255` (the proxy that injects credentials). `ONECLI_BIND_HOST=0.0.0.0` in `/home/nanoclaw/.onecli/.env`, so both the NanoClaw host and the agent containers can reach it. The VM has no external address, and the VPC denies inbound traffic, so that bind is not open to the internet.

The NanoClaw host on the VM is pointed at that local gateway only:

* `ONECLI_URL=http://127.0.0.1:10254`
* `NANOCLAW_GATEWAY_PROVIDER=onecli`

The host will not start unless that provider is registered. On this checkout the registration is `import './onecli.js'` in `src/gateway-providers/installed.ts`. Health on `http://127.0.0.1:10254/v1/health` returned 200 on 2026-11-07.

When a session starts, the host asks this local gateway to ensure an agent for that group. The container does not receive API keys. Credentialed calls leave through the gateway, and the gateway adds the credential at the edge. The OneCLI CLI on the VM is also aimed at `http://127.0.0.1:10254`, which is how `onecli apps connections list` read the 12 local connections.

The console is that same local service. From the Mac it is opened by forwarding port `18080` to the VM's `127.0.0.1:10254`, as in [saul2.md](saul2.md). That page is the gateway on the VM, not the OneCLI website.

## What is still the website

The `onecli` command on the Mac is still configured with `api-host` `https://api.onecli.sh`. That setting was left alone on purpose. It is the operator's cloud CLI. It is not the path Saul2 or the other agents use.

## What to repeat for a new client

1. Give the client one machine with Docker, and no public inbound path to the gateway ports.
2. Run OneCLI there, with the bind set so the NanoClaw host and the agent containers can both reach ports `10254` and `10255`.
3. Point that copy's `ONECLI_URL` at `http://127.0.0.1:10254` and set `NANOCLAW_GATEWAY_PROVIDER=onecli`.
4. Create each agent inside that local gateway and grant only the connections that agent should use.
5. Open the console through a tunnel to that machine's port `10254`. Do not send the agents to `api.onecli.sh`.

This VM is still OneCLI `1.41.0` because the vault was copied at that version. The current skill pin is `1.45.0`. Stay on `1.41.0` for this vault until an upgrade is chosen on purpose. The live Mac gateway and `nanoclaw-vm` were not changed to make this work.
