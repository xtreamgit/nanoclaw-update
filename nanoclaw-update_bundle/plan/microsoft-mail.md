---
type: Procedure
title: Enter a client's Microsoft credentials
description: Register one Entra app per client and write ~/microsoft-mail.env on the machine that runs the mail broker.
status: current
created: 2026-11-07
sources:
  - resource: local-onecli.md
    title: Develom can host OneCLI for every client
---

# Enter a client's Microsoft credentials

Outlook, Microsoft Calendar, and Excel are outside the OneCLI vault on this VM. The host broker in `src/microsoft-mail/` reads those three for the mailboxes named in `~/microsoft-mail.env`. It does not send mail, and it does not edit a calendar or a workbook.

The checkout and the VM image contain no tenant, no client secret, and no mailbox list. Each client gets one Entra app and one credential file, created on that client's machine. Copying the repo or the image does not copy them.

## Where the file has to be

`pnpm run mail-broker` reads the environment of the machine it is started on. It does not open the file by itself, and it does not fetch the file from another computer. The file belongs in the home directory of the user who starts the broker.

| Machine | File | Use |
| --- | --- | --- |
| Mac workshop | `/Users/hd/microsoft-mail.env` | Written on 2026-11-07. Tests the broker on this Mac. |
| Practice VM | `/home/nanoclaw/microsoft-mail.env` | Written on 2026-11-07. `nanoclaw-mail-broker.service` listens on `172.17.0.1:10256`. |
| A new client | `$HOME/microsoft-mail.env` on that client's host | Created by setup on that host. |

Saul2 runs on the practice VM, so the Mac file does not reach it. Run setup again on the VM when that read is wanted. Leave the file out of git, out of the VM image, out of NanoClaw's `.env`, and out of any agent container.

## 1. Create the app in the client's tenant

Sign in to [Entra admin center](https://entra.microsoft.com) as an admin of that tenant.

1. **Identity** → **Applications** → **App registrations** → **New registration**.
2. Name it `NanoClaw`. Account type: **Accounts in this organizational directory only**. No redirect URI.
3. Copy **Directory (tenant) ID** and **Application (client) ID**.
4. **Certificates & secrets** → **New client secret**. The dialog shows **Value** and **Secret ID**. Copy **Value** before closing the dialog. Azure shows it once. **Secret ID** is only the portal's label for that row.
5. **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**. Add `Mail.Read`, `Calendars.Read`, and `Files.Read.All`. Leave the Delegated OpenID list unchecked. Office 365 Management APIs is a different product.
6. **Grant admin consent**. Each of those three rows should say granted.

A certificate can replace the client secret on a lasting install: upload the public certificate in Entra and keep the private key on the host, mode `600`.

Mail and calendar can be limited to a mail-enabled security group. In Exchange Online PowerShell, as that tenant's admin:

```powershell
New-ApplicationAccessPolicy -AppId <client-id> -PolicyScopeGroupId <mail-enabled-security-group> -AccessRight RestrictAccess -Description "NanoClaw read"
```

`Files.Read.All` is not limited by that Exchange policy. The broker still opens only the drives of addresses listed in the credential file.

Word, Teams, and the rest of Microsoft 365 are more Graph permissions on this same app, added later. One app per client covers them.

## 2. Write the credential file

From the checkout, as the user who will run the broker:

```bash
pnpm run mail-broker:setup
```

The practice VM checkout was `70a06b93` and did not contain `mail-broker:setup`. Do not `git pull` there: that checkout has local OneCLI and Telegram files. On 2026-11-07 the broker source was copied from this Mac onto the VM, and the two scripts were added to its `package.json`.

On the practice VM, `pnpm` is on the `nanoclaw` user's path. The OS Login prompt `hector_develom_com@nanoclaw-update-vm` does not have it. From the Mac:

```bash
gcloud compute ssh nanoclaw-update-vm \
  --project=dvlm-develom-ai \
  --zone=us-central1-a \
  --tunnel-through-iap \
  --command='sudo -u nanoclaw bash -lc "cd /home/nanoclaw/nanoclaw-update && pnpm run mail-broker:setup"'
```

Answer the prompts this way:

| Prompt | What to enter |
| --- | --- |
| Tenant ID | Directory (tenant) ID |
| Application (client) ID | Application (client) ID |
| Mailboxes, comma-separated | Microsoft 365 addresses in that tenant, such as `hector@develom.com`. A display name is not a mailbox. Gmail stays on OneCLI. |
| Credential: secret or certificate? | Press Enter. The default is `secret`. Type `certificate` only after a certificate was uploaded, then give the two PEM paths. Do not paste the Secret ID on this line. |
| Client secret | Paste **Value**. The line stays blank because the prompt does not echo. Do not paste **Secret ID**. Do not paste either string into chat. |

A finished run prints:

```text
Wrote /home/nanoclaw/microsoft-mail.env (mode 600).
The Microsoft secret and the local token are in that file. They were not printed.
Next: pnpm run mail-broker
```

The path in that line is the home directory of whoever ran setup. On this Mac it was `/Users/hd/microsoft-mail.env`. To replace an existing file, run `pnpm run mail-broker:setup -- --replace yes`.

## 3. Start the broker

In the same user's shell:

```bash
set -a
source "$HOME/microsoft-mail.env"
set +a
pnpm run mail-broker
```

Health is a `GET` on the bind address, port `10256`, and returns `{"status":"ok"}`.

On the VM, agent containers reach the host through the Docker bridge, not through `127.0.0.1`. `MICROSOFT_MAIL_BIND` is `172.17.0.1`, and `nanoclaw-mail-broker.service` is enabled from `setup/systemd/nanoclaw-mail-broker.service`. Leave the bind at `127.0.0.1` for a test that only the host itself calls. Do not bind `0.0.0.0` on a machine with a public address.

A read uses the local token from the file. Do not send that token in chat. For one group, write that token as the single line of `groups/<folder>/.microsoft-mail-token` and name `host.docker.internal:10256` in `instructions.prepend.md`. The Microsoft secret stays in the host file.

## What is done

On 2026-11-07 setup finished on the Mac workshop. The file is `/Users/hd/microsoft-mail.env`, mode `600`, for `hector@develom.com` and `robert@develom.com`. The Secret ID was typed on the Credential line and was ignored. The Value was entered at Client secret. Mail and calendar reads succeeded from that Mac process.

The same file was then placed at `/home/nanoclaw/microsoft-mail.env` on the practice VM. `MICROSOFT_MAIL_BIND` is `172.17.0.1`, the Docker bridge, and `nanoclaw-mail-broker.service` is enabled. A container on that bridge received `{"status":"ok"}` from `http://host.docker.internal:10256`. Mail still returned a message for `hector@develom.com`. Excel is still refused. `nanoclaw.service` was not restarted.

Saul's group folder holds `.microsoft-mail-token`, mode `600`, and `instructions.prepend.md` names the broker address. The token is not in the instruction text. Saul's running container keeps its current project document until the next session start.
