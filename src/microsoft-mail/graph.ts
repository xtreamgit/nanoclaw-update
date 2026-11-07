import type { TokenFetcher } from './token.js';

const SELECT_LIST = 'id,subject,from,receivedDateTime,bodyPreview,isRead';
const SELECT_ONE = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,isRead';
const BODY_LIMIT = 20_000;

export type MailSummary = {
  id: string;
  subject: string;
  from: string;
  receivedDateTime: string;
  bodyPreview: string;
  isRead: boolean;
};

export type MailMessage = MailSummary & {
  to: string[];
  cc: string[];
  bodyText: string;
};

type GraphAddress = { emailAddress?: { address?: string; name?: string } };
type GraphMessage = {
  id?: string;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  bodyPreview?: string;
  isRead?: boolean;
  body?: { contentType?: string; content?: string };
};

export function createGraphReader(accessToken: () => Promise<string>, fetchImpl: TokenFetcher) {
  return {
    async listMessages(mailbox: string, top: number): Promise<MailSummary[]> {
      const url = new URL(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`,
      );
      url.searchParams.set('$top', String(top));
      url.searchParams.set('$select', SELECT_LIST);
      url.searchParams.set('$orderby', 'receivedDateTime desc');
      const payload = await graphGet<{ value?: GraphMessage[] }>(url, accessToken, fetchImpl);
      return (payload.value ?? []).map(summarize);
    },
    async getMessage(mailbox: string, id: string): Promise<MailMessage> {
      const url = new URL(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}`,
      );
      url.searchParams.set('$select', SELECT_ONE);
      const message = await graphGet<GraphMessage>(url, accessToken, fetchImpl);
      const summary = summarize(message);
      return {
        ...summary,
        to: addresses(message.toRecipients),
        cc: addresses(message.ccRecipients),
        bodyText: bodyText(message.body).slice(0, BODY_LIMIT),
      };
    },
  };
}

async function graphGet<T>(url: URL, accessToken: () => Promise<string>, fetchImpl: TokenFetcher): Promise<T> {
  const token = await accessToken();
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Microsoft Graph failed (${response.status})`);
  return (await response.json()) as T;
}

function summarize(message: GraphMessage): MailSummary {
  return {
    id: message.id ?? '',
    subject: message.subject ?? '',
    from: address(message.from),
    receivedDateTime: message.receivedDateTime ?? '',
    bodyPreview: message.bodyPreview ?? '',
    isRead: message.isRead === true,
  };
}

function addresses(values: GraphAddress[] | undefined): string[] {
  return (values ?? []).map(address).filter(Boolean);
}

function address(value: GraphAddress | undefined): string {
  return value?.emailAddress?.address ?? '';
}

function bodyText(body: GraphMessage['body']): string {
  const content = body?.content ?? '';
  if ((body?.contentType ?? '').toLowerCase() !== 'html') return content;
  return content
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
