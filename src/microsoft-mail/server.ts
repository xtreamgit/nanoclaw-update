import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { mailboxAllowed, type MailBrokerConfig } from './config.js';
import { createGraphReader } from './graph.js';
import { createTokenSource, type TokenFetcher } from './token.js';

const MESSAGE_ID = /^[A-Za-z0-9_\-=]+$/;

export function createMailBroker(config: MailBrokerConfig, fetchImpl: TokenFetcher = fetch): Server {
  const reader = createGraphReader(createTokenSource(config, fetchImpl), fetchImpl);
  return createServer((request, response) => {
    void handle(config, reader, request, response);
  });
}

async function handle(
  config: MailBrokerConfig,
  reader: ReturnType<typeof createGraphReader>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/health') {
    send(response, 200, { status: 'ok' });
    return;
  }
  if (request.method !== 'GET') {
    send(response, 404, { error: 'not found' });
    return;
  }
  if (!authorized(request, config.brokerToken)) {
    send(response, 401, { error: 'unauthorized' });
    return;
  }

  const list = url.pathname === '/v1/messages';
  const one = url.pathname.match(/^\/v1\/messages\/([^/]+)$/);
  if (!list && !one) {
    send(response, 404, { error: 'not found' });
    return;
  }

  const mailbox = url.searchParams.get('mailbox') ?? '';
  if (!mailboxAllowed(config, mailbox)) {
    send(response, 403, { error: 'mailbox is not allowed' });
    return;
  }

  try {
    if (list) {
      const top = clampTop(url.searchParams.get('top'));
      const messages = await reader.listMessages(mailbox, top);
      send(response, 200, { mailbox, messages });
      return;
    }
    const id = decodeURIComponent(one?.[1] ?? '');
    if (!MESSAGE_ID.test(id)) {
      send(response, 400, { error: 'invalid message id' });
      return;
    }
    send(response, 200, await reader.getMessage(mailbox, id));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'read failed';
    send(response, 502, { error: message });
  }
}

function authorized(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const left = createHash('sha256').update(presented).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function clampTop(value: string | null): number {
  const parsed = Number(value ?? '10');
  if (!Number.isInteger(parsed)) return 10;
  return Math.min(25, Math.max(1, parsed));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}
