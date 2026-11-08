---
name: add-microsoft-mail
description: Connect one client's Microsoft 365 tenant to the NanoClaw template. Use when a client needs Outlook mail, calendar, and Excel reads without OneCLI Cloud.
---

# Add Microsoft mail

The NanoClaw checkout is the template. It contains no client tenant, no client secret, and no mailbox list. Each client gets one Entra app and one credential file on that client's machine. Copying the VM or the repo does not copy those credentials.

The broker reads mail, calendar, and Excel for the mailboxes named in that file. It does not send mail or edit the calendar or a workbook. The Microsoft credential stays on the host.

## 1. Create the client's app

Do this in the client's own Microsoft tenant. Sign in as an admin for that tenant.

1. Open [Entra admin center](https://entra.microsoft.com) → **Identity** → **Applications** → **App registrations** → **New registration**.
2. Name it `NanoClaw`. Supported account types: **Accounts in this organizational directory only**. No redirect URI. Register.
3. Copy **Application (client) ID** and **Directory (tenant) ID**.
4. **Certificates & secrets** → **New client secret**. Copy the secret value immediately. A certificate is preferable for a lasting install: upload the public certificate here and keep the private key on the host.
5. **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**. Add:
   - `Mail.Read`
   - `Calendars.Read`
   - `Files.Read.All` (Excel and the user's OneDrive files)
6. **Grant admin consent** for the tenant. Every row should say granted.

Then limit mail and calendar to the people this client wants agents to read. In Exchange Online PowerShell, as that tenant's admin:

```powershell
New-ApplicationAccessPolicy -AppId <client-id> -PolicyScopeGroupId <mail-enabled-security-group> -AccessRight RestrictAccess -Description "NanoClaw read"
```

The group contains only the mailboxes for this client. `Files.Read.All` is not limited by that Exchange policy. The broker still refuses any user who is not listed in the credential file, and it only opens that user's own drive.

Word, Teams, and the rest of Microsoft 365 are not separate logins. They are more Graph permissions on this same app, added later. Do not create a second app per product.

## 2. Enter the credentials

On the host, from the checkout, run:

```bash
pnpm run mail-broker:setup
```

The command asks for the tenant ID, the client ID, the mailboxes, and the secret. The secret is not shown as you type. It writes `~/microsoft-mail.env` with mode `600` and generates the local agent token. It does not print the secret or the token.

To replace a client's file:

```bash
pnpm run mail-broker:setup -- --replace yes
```

A certificate install answers `certificate` and gives the two PEM paths. Those files stay outside the repo, mode `600`.

The file is gitignored. Do not copy it into the checkout, into NanoClaw's `.env`, or into an agent container.

## 3. Start the broker

On the host, set `MICROSOFT_MAIL_BIND` to the Docker bridge address (`ip -4 addr show docker0`, usually `172.17.0.1`) when agent containers must reach the broker. Leave it at `127.0.0.1` when only the host itself calls the broker. Do not use `0.0.0.0` on a machine with a public address.

```bash
set -a
source "$HOME/microsoft-mail.env"
set +a
pnpm run mail-broker
```

On the template VM the host user is `nanoclaw` and the file is `/home/nanoclaw/microsoft-mail.env`. Install `setup/systemd/nanoclaw-mail-broker.service` so the broker comes back on boot. Health is `GET` on the bind address, port `10256`, and returns `{"status":"ok"}`. Containers call `http://host.docker.internal:10256`.

## 4. Confirm the three reads

Use the local token from the credential file. Do not send it in chat.

```bash
curl -sS -H "Authorization: Bearer $MICROSOFT_MAIL_TOKEN" \
  "http://127.0.0.1:10256/v1/messages?mailbox=person@client.example&top=5"

curl -sS -H "Authorization: Bearer $MICROSOFT_MAIL_TOKEN" \
  "http://127.0.0.1:10256/v1/events?mailbox=person@client.example&start=2026-11-09T00:00:00Z&end=2026-11-16T00:00:00Z"

curl -sS -H "Authorization: Bearer $MICROSOFT_MAIL_TOKEN" \
  "http://127.0.0.1:10256/v1/workbooks?mailbox=person@client.example"
```

One message is `GET /v1/messages/<id>?mailbox=...`. One sheet is `GET /v1/workbooks/<id>?mailbox=...`. A mailbox that is not in the file is refused. Excel files are `.xlsx`, `.xlsm`, and `.xls` in that user's OneDrive.

## 5. Give one agent the local token

Write only the local token, one line, to `groups/<folder>/.microsoft-mail-token` with mode `600`. Tell that group in `instructions.prepend.md` that the broker is `http://host.docker.internal:10256` and that the token is that file. Do not put `MICROSOFT_MAIL_TOKEN` in the container environment: a name ending in `_TOKEN` is refused at spawn. Do not put the token in the instructions file. The Microsoft client secret stays in the host file.

The instruction is composed into the group document on the next session start. Repeat sections 1 and 2 for every new client. The template image does not change.
