import { describe, it, expect } from 'vitest';

import { SECRET_ENV_KEY_RE } from './request.js';
import { CREDENTIAL_ENV_KEY_RE, PROTECTED_MCP_SERVERS, protectedMcpViolation } from './protected-config.js';

describe('protectedMcpViolation', () => {
  it('keeps the credential-key pattern aligned with approval-card redaction', () => {
    expect(CREDENTIAL_ENV_KEY_RE.source).toBe(SECRET_ENV_KEY_RE.source);
    expect(CREDENTIAL_ENV_KEY_RE.flags).toBe(SECRET_ENV_KEY_RE.flags);
  });

  it('blocks adding or modifying the protected email-imap server even with a placeholder', () => {
    const v = protectedMcpViolation({
      name: 'email-imap',
      env: { MCP_EMAIL_SERVER_SMTP_PORT: '587', MCP_EMAIL_SERVER_PASSWORD: 'gateway-managed' },
    });
    expect(v).toBeTruthy();
    expect(v).toMatch(/operator-managed/i);
  });

  it('blocks the port-drift attempt on email-imap regardless of the port value', () => {
    expect(protectedMcpViolation({ name: 'email-imap', env: { MCP_EMAIL_SERVER_SMTP_PORT: '587' } })).toBeTruthy();
  });

  it('blocks removing email-imap by name only', () => {
    expect(protectedMcpViolation({ name: 'email-imap' })).toBeTruthy();
  });

  it('is case-insensitive on the protected server name', () => {
    expect(protectedMcpViolation({ name: 'Email-IMAP' })).toBeTruthy();
  });

  it('blocks a raw credential in env even for a non-protected server', () => {
    const v = protectedMcpViolation({
      name: 'some-other-server',
      env: { SERVICE_PASSWORD: 'not-a-real-secret' },
    });
    expect(v).toBeTruthy();
    expect(v).toMatch(/raw credentials/i);
  });

  it('blocks a raw credential in headers', () => {
    const v = protectedMcpViolation({
      name: 'widget',
      headers: { Authorization: 'Bearer not-a-real-secret' },
    });
    expect(v).toBeTruthy();
    expect(v).toMatch(/header "Authorization"/);
  });

  it('blocks raw secrets passed as a JSON string (the ncl --env form)', () => {
    const v = protectedMcpViolation({
      name: 'widget',
      env: JSON.stringify({ WIDGET_API_KEY: 'not-a-real-secret' }),
    });
    expect(v).toBeTruthy();
  });

  it('allows a legitimate non-credential MCP server', () => {
    expect(protectedMcpViolation({ name: 'fetch', env: { FETCH_TIMEOUT: '30' } })).toBeNull();
  });

  it('allows gateway placeholders for a non-protected server', () => {
    expect(protectedMcpViolation({ name: 'linear', env: { LINEAR_API_KEY: 'gateway-managed' } })).toBeNull();
    expect(protectedMcpViolation({ name: 'linear', env: { LINEAR_API_KEY: 'onecli-managed' } })).toBeNull();
  });

  it('allows empty or missing name and env', () => {
    expect(protectedMcpViolation({})).toBeNull();
    expect(protectedMcpViolation({ name: '', env: {} })).toBeNull();
  });

  it('email-imap is in the protected set', () => {
    expect(PROTECTED_MCP_SERVERS.has('email-imap')).toBe(true);
  });
});
