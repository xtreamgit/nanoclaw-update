---
name: add-microsoft-mail
description: Run the host-side Microsoft mail broker so chosen NanoClaw agents can read specific mailboxes. Use when connecting Outlook or Microsoft 365 mail without OneCLI Cloud.
---

# Add Microsoft mail

This installs nothing into OneCLI. The broker is already in this repo at `src/microsoft-mail/`. It runs on the host, holds the Microsoft credential, and answers read-only inbox calls. Agents never receive the certificate or the client secret. Sending mail is not implemented.

OneCLI Community does not include Outlook. Leave the Google, Vercel, and YouTube connections on the local OneCLI gateway.

## 1. Register the app in the client's tenant

In Microsoft Entra, register a single-tenant app. Add the application permission `Mail.Read` and grant admin consent. Prefer a certificate. A client secret works for a first read, and a certificate is what a client install should keep.

Limit the app to the mailboxes it may read with an Exchange application access policy. The broker also refuses any mailbox that is not listed in `MICROSOFT_MAIL_MAILBOXES`.

Put the certificate and private key outside the repo, mode `600`, owned by the host user. Do not commit them.

## 2. Configure the host

Create a local token with `openssl rand -hex 32`. Write these values where the process can read them and git cannot. On a NanoClaw host that is a file such as `/home/nanoclaw/microsoft-mail.env`, mode `600`:

```bash
MICROSOFT_MAIL_TENANT_ID=
MICROSOFT_MAIL_CLIENT_ID=
MICROSOFT_MAIL_CERT_PATH=
MICROSOFT_MAIL_KEY_PATH=
MICROSOFT_MAIL_TOKEN=
MICROSOFT_MAIL_MAILBOXES=person@client.example
MICROSOFT_MAIL_BIND=127.0.0.1
MICROSOFT_MAIL_PORT=10256
```

Use `MICROSOFT_MAIL_CLIENT_SECRET` only when there is no certificate, and then omit the cert paths. `MICROSOFT_MAIL_BIND` stays `127.0.0.1` until an agent container must reach the broker. On Linux, set it to the Docker bridge address (`ip -4 addr show docker0`) so containers can use `host.docker.internal` and the host's public interfaces still do not listen. Do not bind `0.0.0.0` on a machine that has a public address.

## 3. Start it

From the checkout:

```bash
set -a
source /home/nanoclaw/microsoft-mail.env
set +a
pnpm run mail-broker
```

`GET /health` returns `{"status":"ok"}` with no token. A mailbox read requires `Authorization: Bearer` and the local token. Confirm with a mailbox from the list, then confirm a mailbox that is not on the list is refused.

After `pnpm run build`, a service can run `node dist/microsoft-mail/main.js` with the same environment file. Do not add the Microsoft values to NanoClaw's `.env` if that file is ever copied, and do not put them in an agent container.

## 4. Let one agent read

Give only the chosen group the broker URL and the local token, in that group's own instructions or container environment. The Microsoft credential stays on the host. The agent calls:

```bash
curl -sS -H "Authorization: Bearer $MICROSOFT_MAIL_TOKEN" \
  "http://host.docker.internal:10256/v1/messages?mailbox=person@client.example&top=5"
```

One message is `GET /v1/messages/<id>?mailbox=person@client.example`. There is no send route. Calendar write is not part of this broker.
