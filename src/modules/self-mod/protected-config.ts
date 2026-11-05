/**
 * Layer 3 — credential MCP config is operator-managed.
 *
 * Agents must not add, remove, or modify credential-bearing MCP servers, nor
 * paste raw secret values into MCP config. Blocking it here means a
 * confabulating agent cannot make the change: the request is refused before
 * any approval card is created, so an operator cannot accidentally approve it.
 *
 * Operator (host) callers are not subject to this guard. They manage
 * credentials through the credential gateway.
 *
 * The key pattern matches SECRET_ENV_KEY_RE in ./request.ts. Keep them equal;
 * protected-config.test.ts fails if they drift.
 */

/** MCP servers whose config carries credentials and must never be agent-modifiable. */
export const PROTECTED_MCP_SERVERS = new Set(['email-imap']);

/**
 * Env or header keys that name a secret. Same pattern as SECRET_ENV_KEY_RE.
 */
export const CREDENTIAL_ENV_KEY_RE = /(TOKEN|SECRET|PASSW(OR)?D|API_?KEY|APIKEY|CREDENTIAL|PRIVATE_?KEY|AUTH)/i;

/** Placeholder values the gateway substitutes. They are not raw secrets. */
const CREDENTIAL_PLACEHOLDERS = new Set(['onecli-managed', 'gateway-managed']);

export interface McpConfigChange {
  /** MCP server name being added, removed, or modified. */
  name?: unknown;
  /** env object, or the JSON string form passed via `ncl --env`. */
  env?: unknown;
  /** headers object, or the JSON string form passed via `ncl --headers`. */
  headers?: unknown;
}

/**
 * Rejection reason when an agent may not make this MCP config change, or
 * `null` when the change is allowed. Callers apply this only to
 * agent-originated requests — never to operator/host writes.
 */
export function protectedMcpViolation(change: McpConfigChange): string | null {
  const name = typeof change.name === 'string' ? change.name.toLowerCase() : '';
  if (PROTECTED_MCP_SERVERS.has(name)) {
    return (
      `The "${name}" MCP server holds credentials and is operator-managed. ` +
      `Agents cannot add, remove, or modify it. Ask the operator — credentials ` +
      `are managed through the credential gateway.`
    );
  }

  return rawSecret(parseRecord(change.env), 'env') ?? rawSecret(parseRecord(change.headers), 'header');
}

function rawSecret(record: Record<string, unknown> | null, kind: 'env' | 'header'): string | null {
  if (!record) return null;
  for (const [key, value] of Object.entries(record)) {
    if (!CREDENTIAL_ENV_KEY_RE.test(key)) continue;
    if (typeof value !== 'string' || value === '' || CREDENTIAL_PLACEHOLDERS.has(value)) continue;
    return (
      `Agents cannot set raw credentials in MCP config (${kind} "${key}"). ` +
      `Credentials are managed by the operator and the credential gateway — never ` +
      `paste, guess, or invent a secret value. Use "gateway-managed" as the placeholder.`
    );
  }
  return null;
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
      // eslint-disable-next-line no-catch-all/no-catch-all -- malformed JSON is rejected input, not a fault
    } catch {
      return null;
    }
  }
  return null;
}
