import { createVerify, generateKeyPairSync } from 'node:crypto';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { loadMailBrokerConfig } from './config.js';
import { createMailBroker } from './server.js';
import { buildClientAssertion } from './token.js';

const TOKEN = 'local-broker-token-value';

function config() {
  return loadMailBrokerConfig({
    MICROSOFT_MAIL_TENANT_ID: 'tenant-1',
    MICROSOFT_MAIL_CLIENT_ID: 'client-1',
    MICROSOFT_MAIL_CLIENT_SECRET: 'secret-value',
    MICROSOFT_MAIL_TOKEN: TOKEN,
    MICROSOFT_MAIL_MAILBOXES: 'hector@develom.com',
  });
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no port');
      resolve(address.port);
    });
  });
}

async function get(
  port: number,
  path: string,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('microsoft mail broker', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it('answers health without a token and refuses mail without one', async () => {
    const server = createMailBroker(config(), fetch);
    servers.push(server);
    const port = await listen(server);
    expect((await get(port, '/health')).status).toBe(200);
    expect((await get(port, '/v1/messages?mailbox=hector@develom.com')).status).toBe(401);
  });

  it('reads one allowed mailbox and does not offer a send route', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/oauth2/v2.0/token')) {
        const body = String(init?.body ?? '');
        expect(body).toContain('grant_type=client_credentials');
        expect(body).not.toContain('client_assertion');
        return Response.json({ access_token: 'graph-token', expires_in: 3600 });
      }
      expect(url).toContain('/users/hector%40develom.com/mailFolders/inbox/messages');
      expect(url).not.toContain('sendMail');
      expect((init?.headers as { authorization?: string }).authorization).toBe('Bearer graph-token');
      return Response.json({
        value: [
          {
            id: 'msg-1',
            subject: 'Invoice',
            from: { emailAddress: { address: 'accounts@example.com' } },
            receivedDateTime: '2026-11-07T18:00:00Z',
            bodyPreview: 'Amount due',
            isRead: false,
          },
        ],
      });
    };
    const server = createMailBroker(config(), fetchImpl);
    servers.push(server);
    const port = await listen(server);
    const listed = await get(port, '/v1/messages?mailbox=hector@develom.com&top=5', TOKEN);
    expect(listed.status).toBe(200);
    expect(listed.body.messages).toEqual([
      {
        id: 'msg-1',
        subject: 'Invoice',
        from: 'accounts@example.com',
        receivedDateTime: '2026-11-07T18:00:00Z',
        bodyPreview: 'Amount due',
        isRead: false,
      },
    ]);
    await get(port, '/v1/messages?mailbox=Hector@develom.com', TOKEN);
    expect(calls.filter((call) => call.startsWith('POST'))).toHaveLength(1);

    const denied = await get(port, '/v1/messages?mailbox=other@example.com', TOKEN);
    expect(denied.status).toBe(403);
    const sent = await fetch(`http://127.0.0.1:${port}/v1/messages?mailbox=hector@develom.com`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(sent.status).toBe(404);
  });

  it('returns the text of one message', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/oauth2/')) return Response.json({ access_token: 'graph-token', expires_in: 3600 });
      expect(url).toContain('/messages/msg-1');
      return Response.json({
        id: 'msg-1',
        subject: 'Hello',
        from: { emailAddress: { address: 'a@example.com' } },
        toRecipients: [{ emailAddress: { address: 'hector@develom.com' } }],
        receivedDateTime: '2026-11-07T18:00:00Z',
        bodyPreview: 'Hi',
        isRead: true,
        body: { contentType: 'html', content: '<p>Hello &amp; welcome</p>' },
      });
    };
    const server = createMailBroker(config(), fetchImpl);
    servers.push(server);
    const port = await listen(server);
    const result = await get(port, '/v1/messages/msg-1?mailbox=hector@develom.com', TOKEN);
    expect(result.status).toBe(200);
    expect(result.body.bodyText).toBe('Hello & welcome');
  });

  it('signs a certificate assertion the tenant can verify', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const assertion = buildClientAssertion({
      clientId: 'client-1',
      tenantId: 'tenant-1',
      privateKeyPem: pem,
      x5t: 'thumb',
      now: 1_700_000_000,
    });
    const [header, payload, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({ alg: 'RS256', x5t: 'thumb' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({
      iss: 'client-1',
      sub: 'client-1',
      aud: 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
    });
    expect(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, signature, 'base64url')).toBe(
      true,
    );
  });

  it('refuses to start without a mailbox list', () => {
    expect(() =>
      loadMailBrokerConfig({
        MICROSOFT_MAIL_TENANT_ID: 'tenant-1',
        MICROSOFT_MAIL_CLIENT_ID: 'client-1',
        MICROSOFT_MAIL_CLIENT_SECRET: 'secret-value',
        MICROSOFT_MAIL_TOKEN: TOKEN,
      }),
    ).toThrow(/MICROSOFT_MAIL_MAILBOXES/);
  });
});
