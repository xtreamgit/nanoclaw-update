export type MailBrokerConfig = {
  tenantId: string;
  clientId: string;
  bind: string;
  port: number;
  brokerToken: string;
  mailboxes: string[];
  credential: { kind: 'certificate'; certPath: string; keyPath: string } | { kind: 'secret'; clientSecret: string };
};

const EMAIL = /^[^\s@]+@[^\s@]+$/;

export function loadMailBrokerConfig(env: NodeJS.ProcessEnv): MailBrokerConfig {
  const tenantId = required(env, 'MICROSOFT_MAIL_TENANT_ID');
  const clientId = required(env, 'MICROSOFT_MAIL_CLIENT_ID');
  const brokerToken = required(env, 'MICROSOFT_MAIL_TOKEN');
  if (brokerToken.length < 16) throw new Error('MICROSOFT_MAIL_TOKEN must be at least 16 characters');

  const mailboxes = (env.MICROSOFT_MAIL_MAILBOXES ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (mailboxes.length === 0) throw new Error('MICROSOFT_MAIL_MAILBOXES must name at least one mailbox');
  for (const mailbox of mailboxes) {
    if (!EMAIL.test(mailbox)) throw new Error(`MICROSOFT_MAIL_MAILBOXES has an invalid mailbox: ${mailbox}`);
  }

  const certPath = env.MICROSOFT_MAIL_CERT_PATH?.trim();
  const keyPath = env.MICROSOFT_MAIL_KEY_PATH?.trim();
  const clientSecret = env.MICROSOFT_MAIL_CLIENT_SECRET?.trim();
  let credential: MailBrokerConfig['credential'];
  if (certPath && keyPath) credential = { kind: 'certificate', certPath, keyPath };
  else if (clientSecret) credential = { kind: 'secret', clientSecret };
  else throw new Error('Set MICROSOFT_MAIL_CERT_PATH and MICROSOFT_MAIL_KEY_PATH, or MICROSOFT_MAIL_CLIENT_SECRET');

  const port = Number(env.MICROSOFT_MAIL_PORT ?? '10256');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MICROSOFT_MAIL_PORT must be a TCP port');

  return {
    tenantId,
    clientId,
    bind: env.MICROSOFT_MAIL_BIND?.trim() || '127.0.0.1',
    port,
    brokerToken,
    mailboxes,
    credential,
  };
}

export function mailboxAllowed(config: MailBrokerConfig, mailbox: string): boolean {
  return config.mailboxes.includes(mailbox.trim().toLowerCase());
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}
