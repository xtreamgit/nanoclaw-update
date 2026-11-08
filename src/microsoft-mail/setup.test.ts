import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { writeMicrosoftEnv } from './setup.js';

describe('microsoft client credential file', () => {
  it('writes one client file, mode 600, and keeps a secret that contains an equals sign', () => {
    const dir = mkdtempSync(join(tmpdir(), 'microsoft-mail-'));
    const file = join(dir, 'microsoft-mail.env');
    writeMicrosoftEnv(file, {
      tenantId: 'tenant-1',
      clientId: 'client-1',
      mailboxes: ['Hector@Develom.com'],
      clientSecret: 'abc=def',
      brokerToken: 'local-broker-token-value',
    });
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('MICROSOFT_MAIL_CLIENT_SECRET="abc=def"');
    expect(text).toContain('MICROSOFT_MAIL_MAILBOXES="hector@develom.com"');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
