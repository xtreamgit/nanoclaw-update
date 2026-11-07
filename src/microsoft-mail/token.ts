import { createHash, createPrivateKey, createSign, randomUUID, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { MailBrokerConfig } from './config.js';

const SCOPE = 'https://graph.microsoft.com/.default';

export type TokenFetcher = typeof fetch;

export function buildClientAssertion(input: {
  clientId: string;
  tenantId: string;
  privateKeyPem: string;
  x5t: string;
  now?: number;
}): string {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', x5t: input.x5t }));
  const payload = base64url(
    JSON.stringify({
      aud: tokenUrl(input.tenantId),
      iss: input.clientId,
      sub: input.clientId,
      jti: randomUUID(),
      nbf: now,
      exp: now + 600,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(createPrivateKey(input.privateKeyPem), 'base64url');
  return `${signingInput}.${signature}`;
}

export function certificateThumbprint(certPem: string): string {
  const raw = new X509Certificate(certPem).raw;
  return createHash('sha1').update(raw).digest('base64url');
}

export function createTokenSource(config: MailBrokerConfig, fetchImpl: TokenFetcher) {
  let cached: { token: string; expiresAt: number } | undefined;

  return async function accessToken(): Promise<string> {
    const now = Date.now();
    if (cached && cached.expiresAt - 60_000 > now) return cached.token;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      scope: SCOPE,
    });
    if (config.credential.kind === 'secret') {
      body.set('client_secret', config.credential.clientSecret);
    } else {
      const certPem = readFileSync(config.credential.certPath, 'utf8');
      const keyPem = readFileSync(config.credential.keyPath, 'utf8');
      body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      body.set(
        'client_assertion',
        buildClientAssertion({
          clientId: config.clientId,
          tenantId: config.tenantId,
          privateKeyPem: keyPem,
          x5t: certificateThumbprint(certPem),
        }),
      );
    }
    const response = await fetchImpl(tokenUrl(config.tenantId), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!response.ok || !payload.access_token) {
      throw new Error(`Microsoft token request failed (${response.status}${payload.error ? ` ${payload.error}` : ''})`);
    }
    cached = { token: payload.access_token, expiresAt: now + (payload.expires_in ?? 3600) * 1000 };
    return payload.access_token;
  };
}

function tokenUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}
