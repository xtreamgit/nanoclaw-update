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

  const mailbox = url.searchParams.get('mailbox') ?? '';
  const route = routeFor(url.pathname);
  if (!route) {
    send(response, 404, { error: 'not found' });
    return;
  }
  if (!mailboxAllowed(config, mailbox)) {
    send(response, 403, { error: 'mailbox is not allowed' });
    return;
  }

  try {
    const top = clampTop(url.searchParams.get('top'));
    if (route.kind === 'messages') {
      send(response, 200, { mailbox, messages: await reader.listMessages(mailbox, top) });
      return;
    }
    if (route.kind === 'message') {
      send(response, 200, await reader.getMessage(mailbox, route.id));
      return;
    }
    if (route.kind === 'events') {
      const window = eventWindow(url);
      if (!window) {
        send(response, 400, { error: 'start and end must be ISO dates' });
        return;
      }
      send(response, 200, { mailbox, events: await reader.listEvents(mailbox, window.start, window.end, top) });
      return;
    }
    if (route.kind === 'workbooks') {
      send(response, 200, { mailbox, workbooks: await reader.listWorkbooks(mailbox, top) });
      return;
    }
    send(response, 200, await reader.readWorkbook(mailbox, route.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'read failed';
    send(response, 502, { error: message });
  }
}

type Route =
  | { kind: 'messages' }
  | { kind: 'message'; id: string }
  | { kind: 'events' }
  | { kind: 'workbooks' }
  | { kind: 'workbook'; id: string };

function routeFor(pathname: string): Route | undefined {
  if (pathname === '/v1/messages') return { kind: 'messages' };
  if (pathname === '/v1/events') return { kind: 'events' };
  if (pathname === '/v1/workbooks') return { kind: 'workbooks' };
  const message = pathname.match(/^\/v1\/messages\/([^/]+)$/);
  if (message) return idRoute('message', message[1]);
  const workbook = pathname.match(/^\/v1\/workbooks\/([^/]+)$/);
  if (workbook) return idRoute('workbook', workbook[1]);
  return undefined;
}

function idRoute(kind: 'message' | 'workbook', raw: string): Route | undefined {
  const id = decodeURIComponent(raw);
  if (!MESSAGE_ID.test(id)) return undefined;
  return { kind, id };
}

function eventWindow(url: URL): { start: string; end: string } | undefined {
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!start || !end) return undefined;
  if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return undefined;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
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
